import type { BrowserPort, SessionHandle } from "../../core/ports/browser.port.js";
import type {
  PlatformPort,
  PlatformId,
  SelectorResolution,
  ConversationTurn,
  ToggleOptions,
  TurnFingerprint,
  CompletionResult,
  ContinuationTrigger,
  DownloadLinkDescriptor,
} from "../../core/ports/platform.port.js";
import { TimeoutError, AuthChallengeError } from "../../core/errors/bridge-errors.js";
import { StreamSettlingDetector } from "./settling-detector.js";
import { buildSettleExpr } from "./page-events.js";
import { waitForAndClickSendButton, IS_VISIBLE_JS } from "./driver-helpers.js";
import { getClaudeResolveSelectorsExpr, getClaudeReadThreadExpr, getClaudeFingerprintExpr, getClaudeAwaitCompletionExpr } from "./claude.scripts.js";

export class ClaudeDriver implements PlatformPort {
  public readonly id: PlatformId = "claude";

  public matchesUrl(url: string): boolean { return url.includes("claude.ai"); }
  public getBaseUrl(): string { return "https://claude.ai/new"; }
  public extractThreadId(url: string): string { return url.match(/claude\.ai\/chat\/([a-zA-Z0-9_-]+)/)?.[1] ?? ""; }
  public async resolveSelectors(handle: SessionHandle, browser: BrowserPort): Promise<SelectorResolution> {
    return browser.evaluate<SelectorResolution>(handle, getClaudeResolveSelectorsExpr());
  }

  public async readThread(
    handle: SessionHandle, browser: BrowserPort, options?: { lastNTurns?: number },
  ): Promise<{ layoutVariant: string; turns: ConversationTurn[] }> {
    return browser.evaluate<{ layoutVariant: string; turns: ConversationTurn[] }>(handle, getClaudeReadThreadExpr(options?.lastNTurns ?? 50));
  }

  public async startNewChat(handle: SessionHandle, browser: BrowserPort): Promise<void> {
    const expr = `(() => {
      const btn = document.querySelector('a[href="/new"], button[aria-label="New chat"], button[data-testid="new-chat-button"]');
      if (btn) btn.click(); else window.location.href = "https://claude.ai/new";
    })()`;
    await browser.evaluate(handle, expr);
  }

  public async applyToggles(handle: SessionHandle, browser: BrowserPort, toggles: ToggleOptions): Promise<void> {
    if (toggles.think === undefined) return;
    const expr = `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').toLowerCase().includes('thinking'));
      if (btn) btn.click();
    })()`;
    await browser.evaluate(handle, expr);
  }

  public async submitPrompt(
    handle: SessionHandle,
    browser: BrowserPort,
    prompt: string,
    _files?: string[],
  ): Promise<TurnFingerprint> {
    const isLoginWall = await browser.evaluate<boolean>(handle, `(() => {
      /* authCheck */
      const login = document.querySelector('a[href*="/login"], button[data-testid*="login"], input[type="email"]');
      const composer = document.querySelector('div.ProseMirror[contenteditable="true"], div[contenteditable="true"], #prompt-textarea');
      return Boolean(login && !composer);
    })()`).catch(() => false);
    if (isLoginWall === true) throw new AuthChallengeError("login_required", this.getBaseUrl());

    const fingerprint = await browser
      .evaluate<TurnFingerprint>(handle, getClaudeFingerprintExpr(prompt.length))
      .catch(() => ({ turnCount: 0, lastTurnHash: "", submittedPromptHash: String(prompt.length) }));

    const composerSelector = 'div.ProseMirror[contenteditable="true"], div[contenteditable="true"], #prompt-textarea';
    await browser.fillText(handle, composerSelector, prompt);

    const sendBtnSelector = 'button[aria-label="Send Message"], button[aria-label*="Send"]';
    await waitForAndClickSendButton(browser, handle, sendBtnSelector, composerSelector);

    return fingerprint;
  }

  public async awaitCompletion(
    handle: SessionHandle,
    browser: BrowserPort,
    before: TurnFingerprint,
    timeoutMs: number,
    quiescenceMs: number = 400,
  ): Promise<CompletionResult> {
    const start = Date.now();
    let lastActivity = Date.now();
    let lastLength = 0;
    const idleTimeoutMs = Math.max(timeoutMs, 60_000);
    const maxHardCapMs = Math.max(timeoutMs * 2, 300_000);
    const detector = new StreamSettlingDetector(quiescenceMs);
    const pollIntervalMs = Math.min(100, Math.max(20, Math.floor(quiescenceMs / 4)));

    while (Date.now() - lastActivity < idleTimeoutMs && Date.now() - start < maxHardCapMs) {
      const status = await browser.evaluate<{
        turnsCount: number;
        hasNewTurn: boolean;
        isGenerating: boolean;
        isThinking?: boolean;
        assistantText: string;
        codeBlocks: Array<{ language: string; code: string }>;
      }>(handle, buildSettleExpr(getClaudeAwaitCompletionExpr(before.turnCount), { quiescenceMs, maxWaitMs: Math.max(15000, Math.min(timeoutMs, 120000)) }));

      const text = status.assistantText || (status as any).text || "";
      if (status.isGenerating || status.isThinking || text.length !== lastLength) {
        lastActivity = Date.now();
        lastLength = text.length;
      }

      const hasNewTurn = Boolean(status.hasNewTurn || (text.length > 0 && text !== before.lastTurnHash));
      const settled = hasNewTurn && detector.isSettled({
        isGenerating: status.isGenerating,
        isThinking: status.isThinking,
        contentLength: text.length,
        quiescenceMs,
      });

      if (settled) {
        return {
          status: "complete",
          turn: {
            turnIndex: status.turnsCount !== undefined ? status.turnsCount - 1 : (status as any).turnIndex ?? 0,
            role: "assistant",
            markdownContent: text,
            codeBlocks: status.codeBlocks ?? [],
            contentHash: String(text.length),
          },
          elapsedMs: Date.now() - start,
        };
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new TimeoutError("Claude response timed out", timeoutMs);
  }

  public async findContinuationTrigger(handle: SessionHandle, browser: BrowserPort): Promise<ContinuationTrigger> {
    const expr = `(() => {
      ${IS_VISIBLE_JS}
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Continue'));
      const hasContinuation = isVisible(btn);
      return { hasContinuation, triggerSelector: 'button[aria-label*="Continue"]' };
    })()`;
    return browser.evaluate<ContinuationTrigger>(handle, expr);
  }

  public async triggerContinuation(handle: SessionHandle, browser: BrowserPort): Promise<void> {
    await browser.evaluate(handle, `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Continue'));
      if (btn) btn.click();
    })()`);
  }

  public async findDownloadLinks(handle: SessionHandle, browser: BrowserPort): Promise<DownloadLinkDescriptor[]> {
    const expr = `(() => Array.from(document.querySelectorAll('a[download], a[href^="blob:"]')).map(a => ({ url: a.href, filename: a.getAttribute('download') || undefined })))()`;
    return browser.evaluate<DownloadLinkDescriptor[]>(handle, expr);
  }
}
