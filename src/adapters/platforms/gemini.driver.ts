import type { BrowserPort, SessionHandle } from "../../core/ports/browser.port.js";
import type {
  CompletionResult,
  ContinuationTrigger,
  ConversationTurn,
  DownloadLinkDescriptor,
  PlatformId,
  PlatformPort,
  SelectorResolution,
  ToggleOptions,
  TurnFingerprint,
} from "../../core/ports/platform.port.js";
import { TimeoutError } from "../../core/errors/bridge-errors.js";
import { StreamSettlingDetector } from "./settling-detector.js";
import { buildSettleExpr } from "./page-events.js";
import { submitWithRecovery, IS_VISIBLE_JS } from "./driver-helpers.js";
import { GEMINI_RESOLVE_SELECTORS_EXPR, getGeminiReadThreadExpr, getGeminiFingerprintExpr, getGeminiAwaitCompletionExpr } from "./gemini.scripts.js";

export class GeminiDriver implements PlatformPort {
  public readonly id: PlatformId = "gemini";

  public getBaseUrl(): string { return "https://gemini.google.com/app"; }
  public matchesUrl(url: string): boolean { return url.includes("gemini.google.com"); }

  public extractThreadId(url: string): string {
    const match = url.match(/\/(app|share\/continue)\/([a-zA-Z0-9_-]+)/);
    return match && match[2] ? match[2] : "default";
  }

  public async resolveSelectors(handle: SessionHandle, browser: BrowserPort): Promise<SelectorResolution> {
    return browser.evaluate<SelectorResolution>(handle, GEMINI_RESOLVE_SELECTORS_EXPR);
  }

  public async readThread(
    handle: SessionHandle,
    browser: BrowserPort,
    options?: { lastNTurns?: number },
  ): Promise<{ layoutVariant: string; turns: ConversationTurn[] }> {
    const lastN = options?.lastNTurns ?? 50;
    return browser.evaluate<{ layoutVariant: string; turns: ConversationTurn[] }>(handle, getGeminiReadThreadExpr(lastN));
  }

  public async startNewChat(handle: SessionHandle, browser: BrowserPort): Promise<void> {
    const expr = `(() => {
      /* startNewChat */
      const btn = document.querySelector('button[aria-label="New chat"], a[href="/app"]');
      if (btn) btn.click();
      else window.location.href = "https://gemini.google.com/app";
    })()`;
    await browser.evaluate(handle, expr);
  }

  public async applyToggles(handle: SessionHandle, browser: BrowserPort, _toggles: ToggleOptions): Promise<void> {
    await browser.evaluate(handle, `(() => {})()`);
  }

  public async submitPrompt(
    handle: SessionHandle,
    browser: BrowserPort,
    prompt: string,
    _files?: string[],
  ): Promise<TurnFingerprint> {
    const fingerprint = await browser
      .evaluate<TurnFingerprint>(handle, getGeminiFingerprintExpr(prompt.length))
      .catch(() => ({ turnCount: 0, lastTurnHash: "", submittedPromptHash: String(prompt.length) }));

    const composerSelector = 'rich-textarea div.ql-editor.textarea, rich-textarea [contenteditable="true"], p[data-placeholder], div[contenteditable="true"].ql-editor';
    await browser.fillText(handle, composerSelector, prompt);

    const sendBtnSelector = 'button[aria-label="Send message"], button.send-button, button[mattooltip="Send message"], button[aria-label*="Send"]';
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
      }>(handle, buildSettleExpr(getGeminiAwaitCompletionExpr(before.turnCount), { quiescenceMs, maxWaitMs: Math.max(15000, Math.min(timeoutMs, 120000)) }));

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

    throw new TimeoutError("Gemini response timed out", timeoutMs);
  }

  public async findContinuationTrigger(handle: SessionHandle, browser: BrowserPort): Promise<ContinuationTrigger> {
    const expr = `(() => {
      /* findContinuationTrigger */
      ${IS_VISIBLE_JS}
      const b = document.querySelector('button[aria-label*="Continue"], button.continue-btn');
      const hasContinuation = isVisible(b);
      return { hasContinuation, triggerSelector: 'button[aria-label*="Continue"]' };
    })()`;
    return browser.evaluate<ContinuationTrigger>(handle, expr);
  }

  public async triggerContinuation(handle: SessionHandle, browser: BrowserPort): Promise<void> {
    await browser.click(handle, 'button[aria-label*="Continue"], button.continue-btn');
  }

  public async findDownloadLinks(handle: SessionHandle, browser: BrowserPort): Promise<DownloadLinkDescriptor[]> {
    const expr = `(() => {
      /* findDownloadLinks */
      const anchors = Array.from(document.querySelectorAll('a[download], a[href*="/download/"], a[href^="blob:"]'));
      return anchors.map(a => ({ url: a.href, filename: a.getAttribute('download') || a.innerText || undefined, label: a.innerText || undefined }));
    })()`;
    return browser.evaluate<DownloadLinkDescriptor[]>(handle, expr);
  }
}
