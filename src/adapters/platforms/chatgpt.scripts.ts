import { IS_VISIBLE_JS } from "./driver-helpers.js";

export const CHATGPT_RESOLVE_SELECTORS_EXPR = `(() => {
  /* resolveSelectors */
  const cancelDictation = document.querySelector('button[aria-label="Cancel dictation"]');
  if (cancelDictation) cancelDictation.click();
  const pm = document.querySelector('div.ProseMirror[contenteditable="true"]');
  const ta = document.querySelector('#prompt-textarea');
  const ce = document.querySelector('div[contenteditable="true"][data-placeholder]');
  const send = document.querySelector('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send"], button[aria-label="Dictate"]');
  const stop = document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"], button[aria-label="Stop"]:not([aria-label*="dictation" i])');
  const turns = document.querySelectorAll('article[data-testid^="conversation-turn-"], [data-turn-key], div[data-message-author-role]');
  return {
    ok: Boolean((pm || ta || ce) && send),
    layoutVariant: pm || ce ? "chatgpt-2026-prosemirror" : "chatgpt-legacy",
    composerSelector: pm ? "div.ProseMirror[contenteditable='true']" : (ta ? "#prompt-textarea" : "div[contenteditable='true']"),
    sendButtonSelector: send ? 'button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send"]' : null,
    stopIndicatorSelector: stop ? 'button[data-testid="stop-button"], button[aria-label="Stop generating"]' : null,
    turnContainerSelector: turns.length > 0 ? 'article[data-testid^="conversation-turn-"], [data-turn-key]' : "article",
  };
})()`;

export function getChatGPTReadThreadExpr(lastN: number): string {
  return `(() => {
    /* readThread */
    const nodes = Array.from(document.querySelectorAll('article[data-testid^="conversation-turn-"], [data-turn-key], div[data-message-author-role]')).slice(-${lastN});
    const turns = [];
    let index = 0;
    for (const t of nodes) {
      let u = '', a = '';
      const userBlock = t.querySelector('div[data-message-author-role="user"]');
      const assistantBlock = t.querySelector('div[data-message-author-role="assistant"]');
      if (userBlock) u = (userBlock.innerText || '').trim();
      if (assistantBlock) a = (assistantBlock.innerText || '').trim();
      if (!u && !a) {
        for (const b of Array.from(t.querySelectorAll('div.block-BQZwFn, div.whitespace-pre-wrap'))) {
          const txt = b.innerText || '';
          if (txt.startsWith('You said:')) u = txt.replace(/^You said:\\s*/, '').trim();
          else if (txt.startsWith('ChatGPT said:')) a = txt.replace(/^ChatGPT said:\\s*/, '').trim();
        }
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
          const l = p.querySelector('span')?.innerText?.toLowerCase() || p.querySelector('code')?.className?.replace(/^language-/, '') || 'text';
          const code = (p.querySelector('code') || p).textContent || '';
          return { language: l.trim(), code };
        });
        turns.push({ turnIndex: index++, role: 'assistant', markdownContent: a, codeBlocks: cbs, contentHash: String(a.length) });
      }
    }
    return { layoutVariant: 'chatgpt-2026-turnkey', turns };
  })()`;
}

export function getChatGPTSubmitPromptExpr(prompt: string): string {
  return `(async () => {
    /* submitPrompt */
    const findComposer = () => {
      const explicit = document.querySelector('#prompt-textarea, [aria-label="Ask ChatGPT"], form div.ProseMirror[contenteditable="true"]');
      if (explicit) return explicit;
      const allPm = document.querySelectorAll('div.ProseMirror[contenteditable="true"]');
      if (allPm.length > 0) return allPm[allPm.length - 1];
      return document.querySelector('div[contenteditable="true"][data-placeholder], div[contenteditable="true"]');
    };
    let c = findComposer();
    if (!c) {
      const deadline = Date.now() + 6000;
      while (Date.now() < deadline && !c) {
        await new Promise(r => setTimeout(r, 200));
        c = findComposer();
      }
    }
    if (!c) throw new Error("ChatGPT composer not found");

    const turns = Array.from(document.querySelectorAll('article[data-testid^="conversation-turn-"], [data-turn-key], div[data-message-author-role]'));
    const beforeTurns = turns.length;
    const last = turns.length > 0 ? turns[turns.length - 1] : null;
    let lastText = '';
    if (last) {
      const raw = (last.querySelector('div[data-message-author-role="assistant"]')?.innerText || last.innerText || '');
      const idx = raw.lastIndexOf('ChatGPT said:');
      lastText = idx !== -1 ? raw.substring(idx + 'ChatGPT said:'.length).trim() : raw.trim();
    }
    c.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, ${JSON.stringify(prompt)});
    c.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => setTimeout(r, 150));
    const send = document.querySelector('button[data-testid="send-button"], button[aria-label="Send prompt"], button[aria-label="Send"]');
    if (send && !send.disabled && send.getAttribute('aria-disabled') !== 'true') send.click();
    else c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    return { turnCount: beforeTurns, lastTurnHash: lastText, submittedPromptHash: String(${prompt.length}) };
  })()`;
}

export function getChatGPTFingerprintExpr(promptLength: number): string {
  return `(() => {
    /* submitPrompt */
    const turns = Array.from(document.querySelectorAll('article[data-testid^="conversation-turn-"], [data-turn-key], div[data-message-author-role]'));
    const beforeTurns = turns.length;
    const last = turns.length > 0 ? turns[turns.length - 1] : null;
    let lastText = '';
    if (last) {
      const asst = last.querySelector('[data-markdown-text-style="assistant-message"], [data-chatgpt-search-unit-key*="assistant"], [data-dil-message-id], div[data-message-author-role="assistant"]');
      if (asst) {
        let txt = (asst.innerText || '').trim();
        const idx = txt.lastIndexOf('ChatGPT said:');
        lastText = idx !== -1 ? txt.substring(idx + 'ChatGPT said:'.length).trim() : txt;
      } else {
        const raw = last.innerText || '';
        const idx = raw.lastIndexOf('ChatGPT said:');
        if (idx !== -1) lastText = raw.substring(idx + 'ChatGPT said:'.length).trim();
      }
    }
    return { turnCount: beforeTurns, lastTurnHash: lastText, submittedPromptHash: String(${promptLength}) };
  })()`;
}

export function getChatGPTAwaitCompletionExpr(beforeTurnCount: number): string {
  return `(() => {
    /* awaitCompletion */
    ${IS_VISIBLE_JS}
    const stop = document.querySelector('button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"], button[aria-label="Stop"]:not([aria-label*="dictation" i])');
    const regen = document.querySelector('button[aria-label="Regenerate response"], button[data-testid="regenerate-button"]');
    const isGenerating = Boolean(stop && isVisible(stop) && !regen);

    const thought = document.querySelector('div[data-testid*="thought"], div[data-testid*="thinking"], div[class*="thought"], button[data-testid*="thought"]');
    const isThinking = Boolean(
      thought && (
        thought.querySelector('.animate-pulse, [class*="shimmer"], [class*="spin"], svg.animate-spin') ||
        (thought.innerText || '').includes('Thinking...')
      )
    );

    const turns = Array.from(document.querySelectorAll('article[data-testid^="conversation-turn-"], [data-turn-key], div[data-message-author-role]'));
    const hasNewTurn = turns.length > ${beforeTurnCount};
    const last = turns.length > 0 ? turns[turns.length - 1] : null;
    let assistantText = '';
    if (last) {
      const asst = last.querySelector('[data-markdown-text-style="assistant-message"], [data-chatgpt-search-unit-key*="assistant"], [data-dil-message-id], div[data-message-author-role="assistant"]');
      if (asst) {
        let txt = (asst.innerText || '').trim();
        const idx = txt.lastIndexOf('ChatGPT said:');
        assistantText = idx !== -1 ? txt.substring(idx + 'ChatGPT said:'.length).trim() : txt;
      } else {
        const raw = last.innerText || '';
        const idx = raw.lastIndexOf('ChatGPT said:');
        if (idx !== -1) assistantText = raw.substring(idx + 'ChatGPT said:'.length).trim();
      }
    }

    const codeBlocks = last ? Array.from(last.querySelectorAll('[class*="CodeBlock"], pre')).filter(b => b.classList.toString().includes('CodeBlock') || !b.closest('[class*="CodeBlock"]')).map(b => {
      const cnt = b.querySelector('.cm-content') || b.querySelector('code') || b;
      const rLang = b.querySelector('code')?.className?.replace(/^language-/, '') || (b.innerText || '').split(/\\s+/)[0];
      return { language: (rLang || 'text').trim().split(/\\s+/)[0].toLowerCase(), code: (cnt ? (cnt.innerText || cnt.textContent) : '').trim() };
    }) : [];

    return { turnsCount: turns.length, hasNewTurn, isGenerating, isThinking, assistantText, codeBlocks };
  })()`;
}
