import type { BrowserPort, SessionHandle } from "../../core/ports/browser.port.js";
import type {
  CanvasDocument, CompletionResult, ContinuationTrigger, ConversationTurn,
  PlatformId, PlatformPort, SelectorResolution, ToggleOptions, TurnFingerprint,
} from "../../core/ports/platform.port.js";
import { TimeoutError } from "../../core/errors/bridge-errors.js";
import { CHATGPT_RESOLVE_SELECTORS_EXPR, getChatGPTReadThreadExpr } from "./chatgpt.scripts.js";

export class ChatGPTDriver implements PlatformPort {
  public readonly id: PlatformId = "chatgpt";

  public getBaseUrl(): string {
    return "https://chatgpt.com/";
  }

  public matchesUrl(url: string): boolean {
    return url.includes("chatgpt.com") || url.includes("chat.openai.com");
  }

  public extractThreadId(url: string): string {
    return url.match(/\/c\/([a-zA-Z0-9-]+)/)?.[1] ?? "default";
  }

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
    const expr = `(() => {
      /* startNewChat */
      const btn = document.querySelector('button[aria-label="New chat"], a[href="/"], button[data-testid="new-chat-button"]');
      if (btn) (btn as HTMLElement).click();
      else window.location.href = "https://chatgpt.com/";
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
    const expression = `(async () => {
      /* submitPrompt */
      const c = document.querySelector('div.ProseMirror[contenteditable="true"]') || document.querySelector('#prompt-textarea');
      if (!c) throw new Error("ChatGPT composer not found");
      const turns = Array.from(document.querySelectorAll('[data-turn-key]'));
      const beforeTurns = turns.length;
      const last = turns.length > 0 ? turns[turns.length - 1] : null;
      let lastText = '';
      if (last) {
        const raw = last.innerText || '';
        const idx = raw.lastIndexOf('ChatGPT said:');
        lastText = idx !== -1 ? raw.substring(idx + 'ChatGPT said:'.length).trim() : raw.trim();
      }
      c.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, ${JSON.stringify(prompt)});
      c.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 80));
      const send = document.querySelector('button[aria-label="Send"], button[data-testid="send-button"]');
      if (send && !send.disabled && send.getAttribute('aria-disabled') !== 'true') send.click();
      else c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
      return { turnCount: beforeTurns, lastTurnHash: lastText, submittedPromptHash: String(${prompt.length}) };
    })()`;
    return browser.evaluate<TurnFingerprint>(handle, expression);
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
        turnsCount: number; hasNewTurn: boolean; isGenerating: boolean; assistantText: string; codeBlocks: Array<{ language: string; code: string }>;
      }>(
        handle,
        `(() => {
          /* awaitCompletion */
          const stop = document.querySelector('button[aria-label*="Stop"], button[data-testid="stop-button"]');
          const isGenerating = Boolean(stop && stop.offsetParent !== null);
          const turns = Array.from(document.querySelectorAll('[data-turn-key]'));
          const hasNewTurn = turns.length > ${before.turnCount};
          const last = turns.length > 0 ? turns[turns.length - 1] : null;
          let assistantText = '';
          if (last) {
            const raw = last.innerText || '';
            const idx = raw.lastIndexOf('ChatGPT said:');
            assistantText = idx !== -1 ? raw.substring(idx + 'ChatGPT said:'.length).trim() : raw.trim();
          }
          const codeBlocks = last ? Array.from(last.querySelectorAll('[class*="CodeBlock"], pre')).filter(b => b.classList.toString().includes('CodeBlock') || !b.closest('[class*="CodeBlock"]')).map(b => {
            const cnt = b.querySelector('.cm-content') || b.querySelector('code') || b;
            const rLang = b.querySelector('code')?.className?.replace(/^language-/, '') || (b.innerText || '').split(/\\s+/)[0];
            return { language: (rLang || 'text').trim().split(/\\s+/)[0].toLowerCase(), code: (cnt ? (cnt.innerText || cnt.textContent) : '').trim() };
          }) : [];
          return { turnsCount: turns.length, hasNewTurn, isGenerating, assistantText, codeBlocks };
        })()`,
      );

      const hasNewTurn = Boolean(status.hasNewTurn || (status.assistantText && status.assistantText.length > 0 && status.assistantText !== before.lastTurnHash));

      if (hasNewTurn && !status.isGenerating && status.assistantText.length > 0) {
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
      const b = document.querySelector('button[aria-label*="Continue generating"], button.continue-btn');
      return { hasContinuation: Boolean(b && b.offsetParent !== null), triggerSelector: 'button[aria-label*="Continue generating"]' };
    })()`;
    return browser.evaluate<ContinuationTrigger>(handle, expr);
  }

  public async triggerContinuation(handle: SessionHandle, browser: BrowserPort): Promise<void> {
    await browser.click(handle, 'button[aria-label*="Continue generating"], button.continue-btn');
  }
}
