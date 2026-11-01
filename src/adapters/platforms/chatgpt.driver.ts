import type { BrowserPort, SessionHandle } from "../../core/ports/browser.port.js";
import type {
  CanvasDocument, CompletionResult, ContinuationTrigger, ConversationTurn,
  PlatformId, PlatformPort, SelectorResolution, ToggleOptions, TurnFingerprint,
} from "../../core/ports/platform.port.js";
import { TimeoutError } from "../../core/errors/bridge-errors.js";
import { StreamSettlingDetector } from "./settling-detector.js";
import { CHATGPT_RESOLVE_SELECTORS_EXPR, getChatGPTReadThreadExpr, getChatGPTSubmitPromptExpr } from "./chatgpt.scripts.js";

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
      if (btn) btn.click();
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
    return browser.evaluate<TurnFingerprint>(handle, getChatGPTSubmitPromptExpr(prompt));
  }

  public async awaitCompletion(
    handle: SessionHandle,
    browser: BrowserPort,
    before: TurnFingerprint,
    timeoutMs: number,
    quiescenceMs: number = 400,
  ): Promise<CompletionResult> {
    const start = Date.now();
    const detector = new StreamSettlingDetector(quiescenceMs);
    const pollIntervalMs = Math.min(100, Math.max(20, Math.floor(quiescenceMs / 4)));

    while (Date.now() - start < timeoutMs) {
      const status = await browser.evaluate<{
        turnsCount: number;
        hasNewTurn: boolean;
        isGenerating: boolean;
        isThinking?: boolean;
        assistantText: string;
        codeBlocks: Array<{ language: string; code: string }>;
      }>(
        handle,
        `(() => {
          /* awaitCompletion */
          const stop = document.querySelector('button[data-testid="stop-button"], button[aria-label*="Stop"], button[aria-label="Stop generating"]');
          const isGenerating = Boolean(stop && stop.offsetParent !== null);

          const thought = document.querySelector('div[data-testid*="thought"], div[data-testid*="thinking"], div[class*="thought"], button[data-testid*="thought"]');
          const isThinking = Boolean(
            thought && (
              thought.querySelector('.animate-pulse, [class*="shimmer"], [class*="spin"], svg.animate-spin') ||
              (thought.innerText || '').includes('Thinking...')
            )
          );

          const turns = Array.from(document.querySelectorAll('article[data-testid^="conversation-turn-"], [data-turn-key], div[data-message-author-role]'));
          const hasNewTurn = turns.length > ${before.turnCount};
          const last = turns.length > 0 ? turns[turns.length - 1] : null;
          let assistantText = '';
          if (last) {
            const raw = (last.querySelector('div[data-message-author-role="assistant"]')?.innerText || last.innerText || '');
            const idx = raw.lastIndexOf('ChatGPT said:');
            assistantText = idx !== -1 ? raw.substring(idx + 'ChatGPT said:'.length).trim() : raw.trim();
          }

          const codeBlocks = last ? Array.from(last.querySelectorAll('[class*="CodeBlock"], pre')).filter(b => b.classList.toString().includes('CodeBlock') || !b.closest('[class*="CodeBlock"]')).map(b => {
            const cnt = b.querySelector('.cm-content') || b.querySelector('code') || b;
            const rLang = b.querySelector('code')?.className?.replace(/^language-/, '') || (b.innerText || '').split(/\\s+/)[0];
            return { language: (rLang || 'text').trim().split(/\\s+/)[0].toLowerCase(), code: (cnt ? (cnt.innerText || cnt.textContent) : '').trim() };
          }) : [];

          return { turnsCount: turns.length, hasNewTurn, isGenerating, isThinking, assistantText, codeBlocks };
        })()`,
      );

      const text = status.assistantText || (status as any).text || "";
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
      const b = document.querySelector('button[aria-label*="Continue generating"], button.continue-btn');
      return { hasContinuation: Boolean(b && b.offsetParent !== null), triggerSelector: 'button[aria-label*="Continue generating"]' };
    })()`;
    return browser.evaluate<ContinuationTrigger>(handle, expr);
  }

  public async triggerContinuation(handle: SessionHandle, browser: BrowserPort): Promise<void> {
    await browser.click(handle, 'button[aria-label*="Continue generating"], button.continue-btn');
  }
}
