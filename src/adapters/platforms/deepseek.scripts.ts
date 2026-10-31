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
