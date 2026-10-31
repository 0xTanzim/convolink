export const DEEPSEEK_RESOLVE_SELECTORS_EXPR = `(() => {
  /* resolveSelectors */
  const textarea = document.querySelector('textarea');
  const sendBtn = document.querySelector('div[role="button"].ds-button--circle');
  const mdList = document.querySelectorAll('.ds-markdown');
  const stopSvg = document.querySelector('svg linearGradient');

  return {
    ok: Boolean(textarea && sendBtn),
    layoutVariant: "deepseek-standard-v1",
    composerSelector: textarea ? "textarea" : null,
    sendButtonSelector: sendBtn ? 'div[role="button"].ds-button--circle' : null,
    stopIndicatorSelector: stopSvg ? "svg linearGradient" : null,
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
          const b = p.closest('.md-code-block')?.querySelector('.md-code-block-banner-wrap');
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
