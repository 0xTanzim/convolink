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
import { buildStatusProbeExpr } from "./page-events.js";
import { submitWithRecovery, pollUntilSettled, completionText, hasNewCompletion, IS_VISIBLE_JS } from "./driver-helpers.js";
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
      /* convolink:selectors {"composer": "div.ProseMirror[contenteditable='true'], div[contenteditable='true'], #prompt-textarea"} */
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
    await submitWithRecovery(browser, handle, composerSelector, sendBtnSelector, prompt);

    return fingerprint;
  }

  public async awaitCompletion(
    handle: SessionHandle,
    browser: BrowserPort,
    before: TurnFingerprint,
    timeoutMs: number,
    quiescenceMs: number = 400,
  ): Promise<CompletionResult> {
    const { status, elapsedMs, timedOut } = await pollUntilSettled(
      browser,
      handle,
      buildStatusProbeExpr(getClaudeAwaitCompletionExpr(before.turnCount)),
      {
        timeoutMs,
        quiescenceMs,
        textOf: completionText,
        isNew: (candidate) => hasNewCompletion(candidate, before),
      },
    );
    if (timedOut) throw new TimeoutError("Claude response timed out", timeoutMs);

    const text = completionText(status);
    return {
      status: "complete",
      turn: {
        turnIndex: status.turnsCount !== undefined ? status.turnsCount - 1 : (status.turnIndex ?? 0),
        role: "assistant",
        markdownContent: text,
        codeBlocks: status.codeBlocks ?? [],
        contentHash: String(text.length),
      },
      elapsedMs,
    };
  }

  public async findContinuationTrigger(handle: SessionHandle, browser: BrowserPort): Promise<ContinuationTrigger> {
    const expr = `(() => {
      /* findContinuationTrigger */
      ${IS_VISIBLE_JS}
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Continue'));
      const hasContinuation = isVisible(btn);
      return { hasContinuation, triggerSelector: 'button[aria-label*="Continue"]' };
    })()`;
    return browser.evaluate<ContinuationTrigger>(handle, expr);
  }

  public async triggerContinuation(handle: SessionHandle, browser: BrowserPort): Promise<void> {
    await browser.evaluate(handle, `(() => {
      /* triggerContinuation */
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Continue'));
      if (btn) btn.click();
    })()`);
  }

  public async findDownloadLinks(handle: SessionHandle, browser: BrowserPort): Promise<DownloadLinkDescriptor[]> {
    const expr = `(() => Array.from(document.querySelectorAll('a[download], a[href^="blob:"]')).map(a => ({ url: a.href, filename: a.getAttribute('download') || undefined })))()`;
    return browser.evaluate<DownloadLinkDescriptor[]>(handle, expr);
  }
}
