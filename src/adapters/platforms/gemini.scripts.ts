export const GEMINI_RESOLVE_SELECTORS_EXPR = `(() => {
  /* resolveSelectors */
  const quill = document.querySelector('rich-textarea div.ql-editor, rich-textarea [contenteditable="true"], p[data-placeholder], div[contenteditable="true"].ql-editor');
  const send = document.querySelector('button[aria-label="Send message"], button.send-button, button[mattooltip="Send message"], button[aria-label*="Send"]');
  const stop = document.querySelector('button[aria-label="Stop response"], button[aria-label*="Stop"], mat-mdc-progress-spinner, mat-progress-spinner, .sparkle-thinking');
  const turns = document.querySelectorAll('user-query, model-response');
  return {
    ok: Boolean(quill && send),
    layoutVariant: "gemini-quill-2026",
    composerSelector: "rich-textarea div.ql-editor, rich-textarea [contenteditable='true']",
    sendButtonSelector: send ? 'button[aria-label="Send message"], button.send-button' : null,
    stopIndicatorSelector: stop ? 'button[aria-label="Stop response"], button[aria-label*="Stop"]' : null,
    turnContainerSelector: turns.length > 0 ? "user-query, model-response" : null,
  };
})()`;

export function getGeminiReadThreadExpr(lastN: number): string {
  return `(() => {
    /* readThread */
    const nodes = Array.from(document.querySelectorAll('user-query, model-response')).slice(-${lastN});
    const turns = [];
    let index = 0;
    for (const node of nodes) {
      const isUser = node.tagName.toLowerCase() === 'user-query';
      const role = isUser ? 'user' : 'assistant';
      const clone = node.cloneNode(true);
      clone.querySelectorAll('.citation, button, mat-icon, svg, .source-wrapper, .sparkle-thinking').forEach(el => el.remove());
      const rawText = (clone.innerText || clone.textContent || '').trim();
      const codeBlocks = Array.from(node.querySelectorAll('pre')).map(pre => {
        const lang = pre.querySelector('span.code-block-decoration')?.textContent?.toLowerCase() || pre.querySelector('code')?.className?.replace(/^language-/, '') || 'text';
        const code = (pre.querySelector('code') || pre).textContent || '';
        return { language: lang.trim(), code };
      });
      turns.push({ turnIndex: index++, role, markdownContent: rawText, codeBlocks, contentHash: String(rawText.length) });
    }
    return { layoutVariant: 'gemini-quill-2026', turns };
  })()`;
}
