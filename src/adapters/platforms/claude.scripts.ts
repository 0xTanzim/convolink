import { IS_VISIBLE_JS } from "./driver-helpers.js";

export function getClaudeResolveSelectorsExpr(): string {
  return `(() => {
    /* resolveSelectors */
    const composer = document.querySelector('div.ProseMirror[contenteditable="true"], div[contenteditable="true"], div[data-placeholder]');
    const sendBtn = document.querySelector('button[aria-label="Send Message"], button[aria-label*="Send"]');
    const stopBtn = document.querySelector('button[aria-label="Stop Response"], button[aria-label*="Stop"]');
    const turns = document.querySelectorAll('div[data-test-render-count], div.font-claude-message, div[data-is-streaming]');

    const isLogin = document.querySelector('input[type="email"], a[href*="login"], button[data-testid*="login"]');
    const isCloudflare = document.title.includes("Just a moment") || document.querySelector('#challenge-running, #cf-wrapper');

    let blockerState = null;
    if (isLogin) blockerState = "auth_required";
    else if (isCloudflare) blockerState = "captcha";

    return {
      ok: Boolean(composer && sendBtn),
      layoutVariant: "claude-prosemirror-v1",
      composerSelector: composer ? "div.ProseMirror[contenteditable='true']" : null,
      sendButtonSelector: sendBtn ? 'button[aria-label="Send Message"]' : null,
      stopIndicatorSelector: stopBtn ? 'button[aria-label*="Stop"]' : null,
      turnContainerSelector: turns.length > 0 ? "div[data-test-render-count]" : null,
      blockerState,
    };
  })()`;
}

export function getClaudeReadThreadExpr(lastN: number): string {
  return `(() => {
    /* readThread */
    const turnEls = Array.from(document.querySelectorAll('div[data-test-render-count], div.font-claude-message, div[data-is-streaming]'));
    const slice = turnEls.slice(-${lastN});
    const turns = slice.map((el, i) => {
      const isUser = el.querySelector('div[data-testid="user-message"]') || el.className.includes("user");
      const role = isUser ? "user" : "assistant";
      const codeBlocks = Array.from(el.querySelectorAll('pre')).map(p => {
        const lang = (p.querySelector('code')?.className || '').replace(/.*language-(\\w+).*/, '$1') || 'text';
        return { language: lang, code: (p.querySelector('code') || p).textContent || '' };
      });
      const text = (el.innerText || '').trim();
      return { turnIndex: i, role, markdownContent: text, codeBlocks, contentHash: String(text.length) };
    });
    return { layoutVariant: "claude-prosemirror-v1", turns };
  })()`;
}

export function getClaudeFingerprintExpr(promptLength: number): string {
  return `(() => {
    /* submitPrompt */
    const turns = document.querySelectorAll('div[data-test-render-count], div.font-claude-message, div[data-is-streaming]');
    const beforeTurns = turns.length;
    const last = turns.length > 0 ? turns[turns.length - 1] : null;
    const lastText = last ? (last.innerText || '').trim() : '';
    return { turnCount: beforeTurns, lastTurnHash: lastText, submittedPromptHash: String(${promptLength}) };
  })()`;
}

export function getClaudeAwaitCompletionExpr(beforeTurnCount: number): string {
  return `(() => {
    /* awaitCompletion */
    ${IS_VISIBLE_JS}
    const stop = document.querySelector('button[aria-label="Stop Response"], button[aria-label*="Stop"]');
    const streamingEl = document.querySelector('div[data-is-streaming="true"]');
    const isGenerating = Boolean((stop && isVisible(stop)) || streamingEl);

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
      const raw = (last.innerText || '').trim();
      assistantText = raw
        .replace(/^Claude responded:\\s*/i, '')
        .replace(/[\\uE000-\\uF8FF\\s]*(?:just now|\\d+\\s*(?:sec|min|hr|d)s?\\s*ago)[\\s\\S]*$/i, '')
        .trim();
      const pres = last.querySelectorAll('pre');
      pres.forEach(p => {
        const lang = (p.querySelector('code')?.className || '').replace(/.*language-(\\w+).*/, '$1') || 'text';
        codeBlocks.push({ language: lang, code: (p.querySelector('code') || p).textContent || '' });
      });
    }

    return {
      turnsCount: turns.length,
      hasNewTurn: turns.length > ${beforeTurnCount},
      isGenerating,
      isThinking,
      assistantText,
      codeBlocks,
    };
  })()`;
}
