import type { BrowserPort, SessionHandle } from "../../core/ports/browser.port.js";
import type {
  CanvasDocument, CompletionResult, ContinuationTrigger, ConversationTurn,
  PlatformId, PlatformPort, SelectorResolution, ToggleOptions, TurnFingerprint,
} from "../../core/ports/platform.port.js";
import { TimeoutError, AuthChallengeError } from "../../core/errors/bridge-errors.js";
import { StreamSettlingDetector } from "./settling-detector.js";
import { buildSettleExpr } from "./page-events.js";
import { waitForAndClickSendButton, IS_VISIBLE_JS } from "./driver-helpers.js";
import { getTurnstileDetectionExpr, type TurnstileDetectionResult } from "../common/turnstile-detector.js";
import { CHATGPT_RESOLVE_SELECTORS_EXPR, getChatGPTReadThreadExpr, getChatGPTSubmitPromptExpr, getChatGPTFingerprintExpr, getChatGPTAwaitCompletionExpr } from "./chatgpt.scripts.js";

export class ChatGPTDriver implements PlatformPort {
  public readonly id: PlatformId = "chatgpt";

  public getBaseUrl(): string { return "https://chatgpt.com/"; }
  public matchesUrl(url: string): boolean { return url.includes("chatgpt.com") || url.includes("chat.openai.com"); }
  public extractThreadId(url: string): string { return url.match(/\/c\/([a-zA-Z0-9-]+)/)?.[1] ?? "default"; }
  public async resolveSelectors(handle: SessionHandle, browser: BrowserPort): Promise<SelectorResolution> {
    return browser.evaluate<SelectorResolution>(handle, CHATGPT_RESOLVE_SELECTORS_EXPR);
  }

  public async readThread(
    handle: SessionHandle,
    browser: BrowserPort,
    options?: { lastNTurns?: number },
  ): Promise<{ layoutVariant: string; turns: ConversationTurn[] }> {
    const lastN = options?.lastNTurns ?? 50;
    return browser.evaluate<{ layoutVariant: string; turns: ConversationTurn[] }>(handle, getChatGPTReadThreadExpr(lastN));
  }

  public async startNewChat(handle: SessionHandle, browser: BrowserPort): Promise<void> {
    const expr = `(() => { /* startNewChat */
      const btn = document.querySelector('button[aria-label="New chat"], a[href="/"], button[data-testid="new-chat-button"]');
      if (btn) btn.click(); else window.location.href = "https://chatgpt.com/";
    })()`;
    await browser.evaluate(handle, expr);
  }

  public async applyToggles(handle: SessionHandle, browser: BrowserPort, toggles: ToggleOptions): Promise<void> {
    if (toggles.think === undefined) return;
    const expr = `(() => {
      const b = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').trim() === 'Think');
      if (b) b.click();
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
      const login = document.querySelector('[data-testid="login-button"], a[href*="/auth/login"], button[data-testid*="login"]');
      const composer = document.querySelector('#prompt-textarea, [contenteditable="true"]');
      return Boolean(login && !composer);
    })()`).catch(() => false);
    if (isLoginWall === true) throw new AuthChallengeError("login_required", this.getBaseUrl());

    const cf = await browser
      .evaluate<TurnstileDetectionResult>(handle, getTurnstileDetectionExpr())
      .catch(() => ({ detected: false, isInteractive: false }));
    if (cf.detected) {
      throw new AuthChallengeError(cf.isInteractive ? "turnstile" : "cloudflare", this.getBaseUrl());
    }

    const fingerprint = await browser
      .evaluate<TurnFingerprint>(handle, getChatGPTFingerprintExpr(prompt.length))
      .catch(() => ({ turnCount: 0, lastTurnHash: "", submittedPromptHash: String(prompt.length) }));

    await browser.evaluate(handle, `(() => {
      const cancel = document.querySelector('button[aria-label="Cancel dictation"]');
      if (cancel) cancel.click();
    })()`).catch(() => {});

    const composerSelector = 'div.ProseMirror[contenteditable="true"], [aria-label="Ask ChatGPT"], #prompt-textarea, div[contenteditable="true"]';
    await browser.fillText(handle, composerSelector, prompt);

    const sendBtnSelector = 'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send"]';
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
      }>(handle, buildSettleExpr(getChatGPTAwaitCompletionExpr(before.turnCount), { quiescenceMs, maxWaitMs: Math.max(15000, Math.min(timeoutMs, 120000)) }));

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

    throw new TimeoutError("ChatGPT response timed out", timeoutMs);
  }

  public async inspectCanvas(handle: SessionHandle, browser: BrowserPort): Promise<CanvasDocument | null> {
    const expr = `(() => { /* inspectCanvas */
      const c = document.querySelector('div[data-testid="canvas-editor"], div.canvas-content');
      if (!c) return null;
      const t = document.querySelector('div[data-testid="canvas-title"]') || document.querySelector('.canvas-header');
      return { title: t ? (t.innerText || '').trim() : "canvas-artifact", content: (c.innerText || '').trim(), language: "markdown" };
    })()`;
    return browser.evaluate<CanvasDocument | null>(handle, expr);
  }

  public async findContinuationTrigger(handle: SessionHandle, browser: BrowserPort): Promise<ContinuationTrigger> {
    const expr = `(() => { /* findContinuationTrigger */
      ${IS_VISIBLE_JS}
      const b = document.querySelector('button[aria-label*="Continue generating"], button.continue-btn');
      const hasContinuation = isVisible(b);
      return { hasContinuation, triggerSelector: 'button[aria-label*="Continue generating"]' };
    })()`;
    return browser.evaluate<ContinuationTrigger>(handle, expr);
  }

  public async triggerContinuation(handle: SessionHandle, browser: BrowserPort): Promise<void> {
    await browser.click(handle, 'button[aria-label*="Continue generating"], button.continue-btn');
  }
}
