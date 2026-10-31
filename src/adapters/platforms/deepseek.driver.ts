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
import { DEEPSEEK_RESOLVE_SELECTORS_EXPR, getDeepSeekReadThreadExpr } from "./deepseek.scripts.js";

export class DeepSeekDriver implements PlatformPort {
  public readonly id: PlatformId = "deepseek";

  public getBaseUrl(): string { return "https://chat.deepseek.com/"; }
  public matchesUrl(url: string): boolean { return url.includes("chat.deepseek.com"); }
  public extractThreadId(url: string): string {
    const match = url.match(/\/s\/([a-zA-Z0-9-]+)/);
    return match && match[1] ? match[1] : "default";
  }

  public async resolveSelectors(handle: SessionHandle, browser: BrowserPort): Promise<SelectorResolution> {
    return browser.evaluate<SelectorResolution>(handle, DEEPSEEK_RESOLVE_SELECTORS_EXPR);
  }

  public async readThread(
    handle: SessionHandle,
    browser: BrowserPort,
    options?: { lastNTurns?: number },
  ): Promise<{ layoutVariant: string; turns: ConversationTurn[] }> {
    const lastN = options?.lastNTurns ?? 50;
    return browser.evaluate<{ layoutVariant: string; turns: ConversationTurn[] }>(handle, getDeepSeekReadThreadExpr(lastN));
  }

  public async startNewChat(handle: SessionHandle, browser: BrowserPort): Promise<void> {
    const expr = `(() => {
      /* startNewChat */
      const btn = document.querySelector('div.ds-button, button[class*="new-chat"], a[href="/"]');
      if (btn) btn.click();
      else window.location.href = "https://chat.deepseek.com/";
    })()`;
    await browser.evaluate(handle, expr);
  }

  public async applyToggles(handle: SessionHandle, browser: BrowserPort, toggles: ToggleOptions): Promise<void> {
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
    const expression = `(async () => {
      /* submitPrompt */
      const ta = document.querySelector('#chat-input, textarea[placeholder*="Send"], textarea.chat-input, textarea');
      if (!ta) throw new Error("DeepSeek textarea not found");

      const beforeCount = document.querySelectorAll('.ds-markdown').length;
      const lastBefore = beforeCount > 0 ? document.querySelectorAll('.ds-markdown')[beforeCount - 1] : null;
      const lastTurnHash = lastBefore ? (lastBefore.innerText || '').trim() : '';

      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set;
      if (setter) setter.call(ta, ${JSON.stringify(prompt)});
      else ta.value = ${JSON.stringify(prompt)};
      ta.dispatchEvent(new Event('input', { bubbles: true }));

      await new Promise(r => setTimeout(r, 60));
      const sendBtn = document.querySelector('div[role="button"].ds-button--circle, div[role="button"][class*="circle"], div.ds-icon-button, button[class*="send"]');
      if (sendBtn && !sendBtn.className.includes('disabled')) sendBtn.click();
      else ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));

      return { turnCount: beforeCount, lastTurnHash, submittedPromptHash: String(${prompt.length}) };
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
        mdCount: number;
        hasNewTurn?: boolean;
        isGenerating: boolean;
        isThinking?: boolean;
        turnIndex: number;
        text: string;
        codeBlocks: Array<{ language: string; code: string }>;
      }>(
        handle,
        `(() => {
          /* awaitCompletion */
          const circleBtn = document.querySelector('div[role="button"].ds-button--circle, div[role="button"][class*="circle"], div.ds-icon-button');
          const svg = circleBtn ? circleBtn.querySelector('svg') : null;
          const stopBtn = document.querySelector('button[aria-label*="Stop"]');
          const isGenerating = Boolean(
            (stopBtn && stopBtn.offsetParent !== null) ||
            (svg && (svg.innerHTML.includes('linearGradient') || svg.classList.toString().includes('spin'))) ||
            (circleBtn && (circleBtn.querySelector('.ds-icon-spinning') || circleBtn.className.includes('loading')))
          );

          const thought = document.querySelector('div.ds-thought, div[class*="ds-thought"], div[class*="thought"]');
          const isThinking = Boolean(
            thought && (
              thought.querySelector('.ds-icon-spinning, .spinner, [class*="spin"]') ||
              (thought.innerText || '').includes('Thinking...')
            )
          );

          const mdList = Array.from(document.querySelectorAll('.ds-markdown'));
          const last = mdList.length > 0 ? mdList[mdList.length - 1] : null;
          const codeBlocks = last ? Array.from(last.querySelectorAll('pre')).map(p => {
            const b = p.closest('.md-code-block')?.querySelector('.md-code-block-banner-wrap') || p.querySelector('.code-block-header');
            const lang = (b ? (b.innerText || '').trim().split(/\\s+/)[0] : 'text').toLowerCase();
            return { language: lang || 'text', code: (p.querySelector('code') || p).textContent || '' };
          }) : [];

          const text = last ? (last.innerText || '').trim() : '';
          return {
            mdCount: mdList.length,
            hasNewTurn: mdList.length > ${before.turnCount},
            isGenerating,
            isThinking,
            turnIndex: mdList.length - 1,
            text,
            codeBlocks,
          };
        })()`,
      );

      const text = status.text || (status as any).assistantText || "";
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
            turnIndex: status.turnIndex, role: "assistant", markdownContent: text,
            codeBlocks: status.codeBlocks, contentHash: String(text.length),
          },
          elapsedMs: Date.now() - start,
        };
      }

      await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    throw new TimeoutError("DeepSeek response timed out", timeoutMs);
  }

  public async findContinuationTrigger(handle: SessionHandle, browser: BrowserPort): Promise<ContinuationTrigger> {
    return browser.evaluate<ContinuationTrigger>(handle, `(() => {
      /* findContinuationTrigger */
      const btn = document.querySelector('button.ds-button--continue, button[aria-label*="Continue"]');
      return { hasContinuation: Boolean(btn && btn.offsetParent !== null), triggerSelector: "button.ds-button--continue" };
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
