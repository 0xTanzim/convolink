export const CHATGPT_RESOLVE_SELECTORS_EXPR = `(() => {
  /* resolveSelectors */
  const pm = document.querySelector('div.ProseMirror[contenteditable="true"]');
  const ta = document.querySelector('#prompt-textarea');
  const send = document.querySelector('button[aria-label="Send"], button[data-testid="send-button"], button[aria-label="Dictate"], button[aria-label="Start Voice"]');
  const stop = document.querySelector('button[aria-label*="Stop"], button[data-testid="stop-button"]');
  const turns = document.querySelectorAll('[data-turn-key]');
  return {
    ok: Boolean((pm || ta) && send), layoutVariant: pm ? "chatgpt-2026-turnkey" : "chatgpt-legacy",
    composerSelector: pm ? "div.ProseMirror[contenteditable='true']" : "#prompt-textarea",
    sendButtonSelector: send ? 'button[aria-label="Send"]' : null,
    stopIndicatorSelector: stop ? 'button[aria-label*="Stop"]' : null,
    turnContainerSelector: turns.length > 0 ? "[data-turn-key]" : "article",
  };
})()`;

export function getChatGPTReadThreadExpr(lastN: number): string {
  return `(() => {
    /* readThread */
    const nodes = Array.from(document.querySelectorAll('[data-turn-key]')).slice(-${lastN});
    const turns = [];
    let index = 0;
    for (const t of nodes) {
      let u = '', a = '';
      for (const b of Array.from(t.querySelectorAll('div.block-BQZwFn'))) {
        const txt = b.innerText || '';
        if (txt.startsWith('You said:')) u = txt.replace(/^You said:\\s*/, '').trim();
        else if (txt.startsWith('ChatGPT said:')) a = txt.replace(/^ChatGPT said:\\s*/, '').trim();
      }
      if (!u && !a) {
        const raw = t.innerText || '';
        const idx = raw.lastIndexOf('ChatGPT said:');
        if (idx !== -1) {
          u = raw.substring(0, idx).replace(/^You said:\\s*/, '').trim();
          a = raw.substring(idx).replace(/^ChatGPT said:\\s*/, '').trim();
        } else {
          a = raw;
        }
      }
      if (u) {
        turns.push({ turnIndex: index++, role: 'user', markdownContent: u, codeBlocks: [], contentHash: String(u.length) });
      }
      if (a) {
        const cbs = Array.from(t.querySelectorAll('pre')).map(p => {
          const l = p.querySelector('span')?.innerText?.toLowerCase() || 'text';
          const code = (p.querySelector('code') || p).textContent || '';
          return { language: l, code };
        });
        turns.push({ turnIndex: index++, role: 'assistant', markdownContent: a, codeBlocks: cbs, contentHash: String(a.length) });
      }
    }
    return { layoutVariant: 'chatgpt-2026-turnkey', turns };
  })()`;
}
