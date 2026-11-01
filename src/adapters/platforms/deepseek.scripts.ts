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
