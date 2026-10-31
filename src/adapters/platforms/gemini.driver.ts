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
import { GEMINI_RESOLVE_SELECTORS_EXPR, getGeminiReadThreadExpr } from "./gemini.scripts.js";

export class GeminiDriver implements PlatformPort {
  public readonly id: PlatformId = "gemini";

  public getBaseUrl(): string {
    return "https://gemini.google.com/app";
  }

  public matchesUrl(url: string): boolean {
    return url.includes("gemini.google.com");
  }

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
      if (btn) (btn as HTMLElement).click();
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
    const expr = `(() => {
      /* submitPrompt */
      const composer = document.querySelector('rich-textarea div.ql-editor.textarea, rich-textarea [contenteditable="true"]');
      if (!composer) throw new Error("Gemini Quill composer not found");

      const beforeTurns = document.querySelectorAll('user-query, model-response').length;
      composer.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, ${JSON.stringify(prompt)});

      const sendBtn = document.querySelector('button[aria-label="Send message"], button.send-button');
      if (sendBtn) {
        sendBtn.click();
      } else {
        composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      }

      return {
        turnCount: beforeTurns,
        lastTurnHash: String(beforeTurns),
        submittedPromptHash: String(${prompt.length}),
      };
    })()`;
    return browser.evaluate<TurnFingerprint>(handle, expr);
  }

  public async awaitCompletion(
    handle: SessionHandle,
    browser: BrowserPort,
    before: TurnFingerprint,
    timeoutMs: number,
  ): Promise<CompletionResult> {
    const start = Date.now();
    const pollIntervalMs = 500;

    while (Date.now() - start < timeoutMs) {
      const status = await browser.evaluate<{
        turnsCount: number;
        hasNewTurn: boolean;
        isGenerating: boolean;
        assistantText: string;
        codeBlocks: Array<{ language: string; code: string }>;
      }>(
        handle,
        `(() => {
          /* awaitCompletion */
          const spinner = document.querySelector('mat-mdc-progress-spinner, button[aria-label="Stop response"]');
          const isGenerating = Boolean(spinner && (spinner.offsetParent !== null || spinner.tagName.toLowerCase() === 'mat-mdc-progress-spinner'));
          const models = Array.from(document.querySelectorAll('model-response'));
          const turns = Array.from(document.querySelectorAll('user-query, model-response'));
          const hasNewTurn = turns.length > ${before.turnCount};
          const lastModel = models.length > 0 ? models[models.length - 1] : null;

          const assistantText = lastModel ? (lastModel.innerText || '').trim() : '';
          const codeBlocks = lastModel ? Array.from(lastModel.querySelectorAll('pre code')).map(c => ({
            language: c.className.replace(/^language-/, '') || 'text',
            code: c.textContent || '',
          })) : [];

          return { turnsCount: turns.length, hasNewTurn, isGenerating, assistantText, codeBlocks };
        })()`,
      );

      if (status.hasNewTurn && !status.isGenerating && status.assistantText.length > 0) {
        return {
          status: "complete",
          turn: {
            turnIndex: status.turnsCount - 1,
            role: "assistant",
            markdownContent: status.assistantText,
            codeBlocks: status.codeBlocks,
            contentHash: String(status.assistantText.length),
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
      const b = document.querySelector('button[aria-label*="Continue"], button.continue-btn');
      return { hasContinuation: Boolean(b && b.offsetParent !== null), triggerSelector: 'button[aria-label*="Continue"]' };
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
