import { IS_VISIBLE_JS } from "./driver-helpers.js";

export const DEEPSEEK_RESOLVE_SELECTORS_EXPR = `(() => {
  /* resolveSelectors */
  const textarea = document.querySelector('#chat-input, textarea[placeholder*="Send"], textarea.chat-input, textarea');
  const sendBtn = document.querySelector('div[role="button"].ds-button--circle, div[role="button"][class*="circle"], div.ds-icon-button[role="button"], button[class*="send"]');
  const mdList = document.querySelectorAll('.ds-markdown, div.chat-message');
  const stopSvg = document.querySelector('svg linearGradient, div[role="button"].ds-button--circle svg.ds-icon-spinning, button[aria-label*="Stop"]');

  return {
    ok: Boolean(textarea && sendBtn),
    layoutVariant: "deepseek-standard-v1",
    composerSelector: textarea ? "#chat-input, textarea" : null,
    sendButtonSelector: sendBtn ? 'div[role="button"].ds-button--circle, div[role="button"][class*="circle"]' : null,
    stopIndicatorSelector: stopSvg ? "svg linearGradient, button[aria-label*='Stop']" : null,
    turnContainerSelector: mdList.length > 0 ? ".ds-markdown" : null,
  };
})()`;

export function getDeepSeekReadThreadExpr(lastN: number): string {
  return `(() => {
    /* readThread */
    const mdList = Array.from(document.querySelectorAll('.ds-markdown'));
    const slice = mdList.slice(-${lastN});
    
    return {
      layoutVariant: "deepseek-standard-v1",
      turns: slice.map((el, i) => {
        const codeBlocks = Array.from(el.querySelectorAll('pre')).map(p => {
          const b = p.closest('.md-code-block')?.querySelector('.md-code-block-banner-wrap') || p.querySelector('.code-block-header');
          const lang = (b ? (b.innerText || '').trim().split(/\\s+/)[0] : 'text').toLowerCase();
          return { language: lang || 'text', code: (p.querySelector('code') || p).textContent || '' };
        });
        const text = el.innerText || '';
        return {
          turnIndex: i,
          role: "assistant",
          markdownContent: text,
          codeBlocks,
          contentHash: String(text.length),
        };
      }),
    };
  })()`;
}

export function getDeepSeekSubmitPromptExpr(prompt: string): string {
  return `(async () => {
    /* submitPrompt */
    const selector = '#chat-input, textarea[placeholder*="Send"], textarea.chat-input, textarea';
    let ta = document.querySelector(selector);
    if (!ta) {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline && !ta) {
        await new Promise(r => setTimeout(r, 200));
        ta = document.querySelector(selector);
      }
    }
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
}

export function getDeepSeekFingerprintExpr(promptLength: number): string {
  return `(() => {
    /* submitPrompt */
    const mdList = Array.from(document.querySelectorAll('.ds-markdown'));
    const last = mdList.length > 0 ? mdList[mdList.length - 1] : null;
    const lastTurnHash = last ? (last.innerText || '').trim() : '';
    return { turnCount: mdList.length, lastTurnHash, submittedPromptHash: String(${promptLength}) };
  })()`;
}

export function getDeepSeekAwaitCompletionExpr(beforeTurnCount: number): string {
  return `(() => {
    /* awaitCompletion */
    ${IS_VISIBLE_JS}
    const circleBtn = document.querySelector('div[role="button"].ds-button--circle, div[role="button"][class*="circle"], div.ds-icon-button');
    const svg = circleBtn ? circleBtn.querySelector('svg') : null;
    const stopBtn = document.querySelector('button[aria-label*="Stop"]');
    const isGenerating = Boolean(
      (stopBtn && isVisible(stopBtn)) ||
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
      hasNewTurn: mdList.length > ${beforeTurnCount},
      isGenerating,
      isThinking,
      turnIndex: mdList.length - 1,
      text,
      codeBlocks,
    };
  })()`;
}
