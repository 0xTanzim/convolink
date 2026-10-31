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
