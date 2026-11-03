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
import { TimeoutError, AuthChallengeError } from "../../core/errors/bridge-errors.js";
import { buildStatusProbeExpr } from "./page-events.js";
import { submitWithRecovery, pollUntilSettled, completionText, hasNewCompletion, IS_VISIBLE_JS } from "./driver-helpers.js";
import { getTurnstileDetectionExpr, type TurnstileDetectionResult } from "../common/turnstile-detector.js";
import { DEEPSEEK_RESOLVE_SELECTORS_EXPR, getDeepSeekReadThreadExpr, getDeepSeekFingerprintExpr, getDeepSeekAwaitCompletionExpr } from "./deepseek.scripts.js";

export class DeepSeekDriver implements PlatformPort {
  public readonly id: PlatformId = "deepseek";

  public getBaseUrl(): string { return "https://chat.deepseek.com/"; }
  public matchesUrl(url: string): boolean { return url.includes("chat.deepseek.com"); }
  public extractThreadId(url: string): string { return url.match(/\/s\/([a-zA-Z0-9-]+)/)?.[1] ?? "default"; }
  public async resolveSelectors(handle: SessionHandle, browser: BrowserPort): Promise<SelectorResolution> {
    return browser.evaluate<SelectorResolution>(handle, DEEPSEEK_RESOLVE_SELECTORS_EXPR);
  }

  public async readThread(
    handle: SessionHandle, browser: BrowserPort, options?: { lastNTurns?: number },
  ): Promise<{ layoutVariant: string; turns: ConversationTurn[] }> {
    return browser.evaluate<{ layoutVariant: string; turns: ConversationTurn[] }>(handle, getDeepSeekReadThreadExpr(options?.lastNTurns ?? 50));
  }

  public async startNewChat(handle: SessionHandle, browser: BrowserPort): Promise<void> {
    const expr = `(() => {
      /* startNewChat */
      const btn = document.querySelector('div.ds-button, button[class*="new-chat"], a[href="/"]');
      if (btn) btn.click(); else window.location.href = "https://chat.deepseek.com/";
    })()`;
    await browser.evaluate(handle, expr);
  }

  public async applyToggles(handle: SessionHandle, browser: BrowserPort, toggles: ToggleOptions): Promise<void> {
    if (toggles.search === undefined && toggles.think === undefined) return;
    const expression = `(() => {
      const toggleButtons = Array.from(document.querySelectorAll('.ds-toggle-button'));
      for (const btn of toggleButtons) {
        const text = (btn.innerText || '').trim();
        const isSelected = (btn.className || '').includes('ds-toggle-button--selected');
        if (${toggles.search !== undefined} && text.includes('Search') && isSelected !== ${Boolean(toggles.search)}) btn.click();
        if (${toggles.think !== undefined} && text.includes('DeepThink') && isSelected !== ${Boolean(toggles.think)}) btn.click();
      }
    })()`;
    await browser.evaluate(handle, expression);
  }

  public async submitPrompt(
    handle: SessionHandle,
    browser: BrowserPort,
    prompt: string,
    _files?: string[],
  ): Promise<TurnFingerprint> {
    const isLoginWall = await browser.evaluate<boolean>(handle, `(() => {
      /* authCheck */
      const login = document.querySelector('div[class*="login"], button[class*="login"], a[href*="login"]');
      const composer = document.querySelector('textarea#chat-input, textarea[placeholder*="DeepSeek"], div[contenteditable="true"]');
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
      .evaluate<TurnFingerprint>(handle, getDeepSeekFingerprintExpr(prompt.length))
      .catch(() => ({ turnCount: 0, lastTurnHash: "", submittedPromptHash: String(prompt.length) }));

    const composerSelector = 'textarea#chat-input, textarea[placeholder*="DeepSeek"], div[contenteditable="true"]';
    await browser.fillText(handle, composerSelector, prompt);

    const sendBtnSelector = 'div[role="button"].ds-button--circle, div.ds-button--circle, button[aria-label*="send"], div.send-button';
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
      buildStatusProbeExpr(getDeepSeekAwaitCompletionExpr(before.turnCount)),
      {
        timeoutMs,
        quiescenceMs,
        textOf: completionText,
        isNew: (candidate) => hasNewCompletion(candidate, before),
      },
    );
    if (timedOut) throw new TimeoutError("DeepSeek response timed out", timeoutMs);

    // `completionText` includes the mounted reasoning panel; the answer itself
    // is rendered in the markdown block.
    // The newest assistant answer, not the first one on the page: the trailing
    // message is the user prompt, so the answer is the previous message node.
    const answer = await browser
      .evaluate<string>(
        handle,
        `(() => {
          /* getLastText */
          const all = Array.from(document.querySelectorAll(".ds-assistant-message-main-content"));
          const el = all[all.length - 1];
          return el ? (el.innerText || "").trim() : "";
        })()`,
      )
      .catch(() => "");
    const answerText = typeof answer === "string" ? answer.trim() : "";
    const text = answerText || completionText(status);
    return {
      status: "complete",
      turn: {
        turnIndex: status.turnIndex ?? 0,
        role: "assistant",
        markdownContent: text,
        codeBlocks: status.codeBlocks ?? [],
        contentHash: String(text.length),
      },
      elapsedMs,
    };
  }

  public async findContinuationTrigger(handle: SessionHandle, browser: BrowserPort): Promise<ContinuationTrigger> {
    return browser.evaluate<ContinuationTrigger>(handle, `(() => {
      /* findContinuationTrigger */
      ${IS_VISIBLE_JS}
      const btn = document.querySelector('button.ds-button--continue, button[aria-label*="Continue"]');
      const hasContinuation = isVisible(btn);
      return { hasContinuation, triggerSelector: "button.ds-button--continue" };
    })()`);
  }

  public async triggerContinuation(handle: SessionHandle, browser: BrowserPort): Promise<void> {
    await browser.click(handle, 'button.ds-button--continue, button[aria-label*="Continue"]');
  }

  public async findDownloadLinks(handle: SessionHandle, browser: BrowserPort): Promise<DownloadLinkDescriptor[]> {
    return browser.evaluate<DownloadLinkDescriptor[]>(handle, `(() => {
      /* findDownloadLinks */
      return Array.from(document.querySelectorAll('a[download], a[href^="blob:"]')).map(a => ({ url: a.href, filename: a.getAttribute('download') || undefined }));
    })()`);
  }
}
