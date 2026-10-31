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
import { TimeoutError } from "../../core/errors/bridge-errors.js";
import { StreamSettlingDetector } from "./settling-detector.js";
import { getClaudeResolveSelectorsExpr, getClaudeReadThreadExpr } from "./claude.scripts.js";

export class ClaudeDriver implements PlatformPort {
  public readonly id: PlatformId = "claude";

  public matchesUrl(url: string): boolean { return url.includes("claude.ai"); }
  public getBaseUrl(): string { return "https://claude.ai/new"; }
  public extractThreadId(url: string): string {
    const match = url.match(/claude\.ai\/chat\/([a-zA-Z0-9_-]+)/);
    return match && match[1] ? match[1] : "";
  }
  public async resolveSelectors(handle: SessionHandle, browser: BrowserPort): Promise<SelectorResolution> {
    return browser.evaluate<SelectorResolution>(handle, getClaudeResolveSelectorsExpr());
  }

  public async readThread(
    handle: SessionHandle,
    browser: BrowserPort,
    options?: { lastNTurns?: number },
  ): Promise<{ layoutVariant: string; turns: ConversationTurn[] }> {
    const lastN = options?.lastNTurns ?? 50;
    return browser.evaluate<{ layoutVariant: string; turns: ConversationTurn[] }>(handle, getClaudeReadThreadExpr(lastN));
  }

  public async startNewChat(handle: SessionHandle, browser: BrowserPort): Promise<void> {
    const expr = `(() => {
      const btn = document.querySelector('a[href="/new"], button[aria-label="New chat"], button[data-testid="new-chat-button"]');
      if (btn) btn.click();
      else window.location.href = "https://claude.ai/new";
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
    const expression = `(async () => {
      /* submitPrompt */
      const composer = document.querySelector('div.ProseMirror[contenteditable="true"], div[contenteditable="true"], #prompt-textarea');
      if (!composer) throw new Error("Claude composer not found");
      const turns = document.querySelectorAll('div[data-test-render-count], div.font-claude-message, div[data-is-streaming]');
      const beforeTurns = turns.length;
      const last = turns.length > 0 ? turns[turns.length - 1] : null;
      const lastText = last ? (last.innerText || '').trim() : '';

      composer.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, ${JSON.stringify(prompt)});
      composer.dispatchEvent(new Event('input', { bubbles: true }));

      await new Promise(r => setTimeout(r, 80));
      const send = document.querySelector('button[aria-label="Send Message"], button[aria-label*="Send"]');
      if (send && !send.disabled && send.getAttribute('aria-disabled') !== 'true') send.click();
      else composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));

      return { turnCount: beforeTurns, lastTurnHash: lastText, submittedPromptHash: String(${prompt.length}) };
    })()`;
    return browser.evaluate<TurnFingerprint>(handle, expression);
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
          const stop = document.querySelector('button[aria-label="Stop Response"], button[aria-label*="Stop"]');
          const streamingEl = document.querySelector('div[data-is-streaming="true"]');
          const isGenerating = Boolean((stop && stop.offsetParent !== null) || streamingEl);

          const thinkingEl = document.querySelector('div[data-testid*="thought"], div[data-testid*="thinking"], div[class*="thinking"], button[aria-label*="Thinking"]');
          const isThinking = Boolean(
            thinkingEl && (
              thinkingEl.querySelector('[class*="spin"], svg.animate-spin, .animate-pulse') ||
              (thinkingEl.innerText || '').includes('Thinking...') ||
              document.querySelector('div[data-is-streaming="true"] [class*="thinking"]')
            )
          );

          const turns = Array.from(document.querySelectorAll('div[data-test-render-count], div.font-claude-message, div[data-is-streaming]'));
          const last = turns.length > 0 ? turns[turns.length - 1] : null;
          let assistantText = '';
          const codeBlocks = [];

          if (last) {
            assistantText = (last.innerText || '').trim();
            const pres = last.querySelectorAll('pre');
            pres.forEach(p => {
              const lang = (p.querySelector('code')?.className || '').replace(/.*language-(\\w+).*/, '$1') || 'text';
              codeBlocks.push({ language: lang, code: (p.querySelector('code') || p).textContent || '' });
            });
          }

          return {
            turnsCount: turns.length,
            hasNewTurn: turns.length > ${before.turnCount},
            isGenerating,
            isThinking,
            assistantText,
            codeBlocks,
          };
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

    throw new TimeoutError("Claude response timed out", timeoutMs);
  }

  public async findContinuationTrigger(handle: SessionHandle, browser: BrowserPort): Promise<ContinuationTrigger> {
    const expr = `(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.innerText || '').includes('Continue'));
      return { hasContinuation: Boolean(btn && btn.offsetParent !== null), triggerSelector: 'button[aria-label*="Continue"]' };
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
    const expr = `(() => {
      const anchors = Array.from(document.querySelectorAll('a[download], a[href^="blob:"]'));
      return anchors.map(a => ({ url: a.href, filename: a.getAttribute('download') || undefined }));
    })()`;
    return browser.evaluate<DownloadLinkDescriptor[]>(handle, expr);
  }
}
