import { IS_VISIBLE_JS } from "./driver-helpers.js";

/**
 * ChatGPT's 2026 transcript no longer uses `article[data-testid^="conversation-turn-"]`
 * or `[data-message-author-role]`. Each message now carries a screen-reader label
 * `[data-conversation-role="user|assistant"]` whose parent element holds the
 * message body. Class names are content-hashed (`block-BQZwFn`) and unusable as
 * selectors, so everything below anchors on that attribute.
 */
export const CHATGPT_TRANSCRIPT_JS = `
  const __roleMarkers = Array.from(document.querySelectorAll('[data-conversation-role]'));
  const __markerTurns = __roleMarkers.map((m) => m.parentElement).filter((n) => Boolean(n));
  const __turns = __markerTurns.length
    ? __markerTurns
    : Array.from(document.querySelectorAll('article[data-testid^="conversation-turn-"], [data-turn-key], div[data-message-author-role]'));
  const __roleOf = (node) => {
    const marker = node.querySelector ? node.querySelector('[data-conversation-role]') : null;
    if (marker) return marker.getAttribute('data-conversation-role');
    const own = node.getAttribute
      ? (node.getAttribute('data-message-author-role') || node.getAttribute('data-conversation-role'))
      : null;
    if (own) return own;
    const text = node.innerText || '';
    if (text.indexOf('ChatGPT said:') !== -1) return 'assistant';
    if (text.indexOf('You said:') !== -1) return 'user';
    return null;
  };
  const __textOf = (node) => {
    const raw = (node && node.innerText ? node.innerText : '').trim();
    const chatgptIdx = raw.lastIndexOf('ChatGPT said:');
    if (chatgptIdx !== -1) return raw.substring(chatgptIdx + 'ChatGPT said:'.length).trim();
    const youIdx = raw.lastIndexOf('You said:');
    if (youIdx !== -1) return raw.substring(youIdx + 'You said:'.length).trim();
    return raw;
  };
  const __lastAssistant = () => {
    for (let i = __turns.length - 1; i >= 0; i--) {
      if (__roleOf(__turns[i]) === 'assistant') return __turns[i];
    }
    return null;
  };
  const __codeBlocksOf = (node) => node
    ? Array.from(node.querySelectorAll('pre')).map((pre) => {
        const codeEl = pre.querySelector('code');
        const code = (codeEl ? codeEl.textContent : pre.textContent) || '';
        const cls = (codeEl && codeEl.className) || '';
        const match = /language-([a-zA-Z0-9_-]+)/.exec(cls);
        return { language: match ? match[1] : 'text', code: code.replace(/\\n$/, '') };
      })
    : [];
`;

export const CHATGPT_SEND_SELECTOR =
  'button[aria-label="Send"], button[data-testid="send-button"], button[aria-label="Send prompt"]';

export const CHATGPT_STOP_SELECTOR =
  'button[data-testid="stop-button"], button[aria-label="Stop generating"], button[aria-label="Stop streaming"], button[aria-label="Stop response"], button[aria-label="Stop"]:not([aria-label*="dictation" i])';

export const CHATGPT_COMPOSER_SELECTOR =
  'div.ProseMirror[contenteditable="true"], #prompt-textarea, div[contenteditable="true"]';

export const CHATGPT_RESOLVE_SELECTORS_EXPR = `(() => {
  /* resolveSelectors */
  const cancelDictation = document.querySelector('button[aria-label="Cancel dictation"]');
  if (cancelDictation) cancelDictation.click();
  const pm = document.querySelector('div.ProseMirror[contenteditable="true"]');
  const ta = document.querySelector('#prompt-textarea');
  const ce = document.querySelector('div[contenteditable="true"][data-placeholder]');
  const send = document.querySelector(${JSON.stringify(CHATGPT_SEND_SELECTOR)});
  const stop = document.querySelector(${JSON.stringify(CHATGPT_STOP_SELECTOR)});
  ${CHATGPT_TRANSCRIPT_JS}
  return {
    ok: Boolean((pm || ta || ce) && send),
    layoutVariant: __roleMarkers.length > 0 ? 'chatgpt-2026-rolemarker' : 'chatgpt-legacy',
    composerSelector: ${JSON.stringify(CHATGPT_COMPOSER_SELECTOR)},
    sendButtonSelector: ${JSON.stringify(CHATGPT_SEND_SELECTOR)},
    stopIndicatorSelector: ${JSON.stringify(CHATGPT_STOP_SELECTOR)},
    turnContainerSelector: __roleMarkers.length > 0 ? '[data-conversation-role]' : 'article',
  };
})()`;

export function getChatGPTReadThreadExpr(lastN: number): string {
  return `(() => {
    /* readThread */
    ${CHATGPT_TRANSCRIPT_JS}
    const turns = [];
    let index = 0;
    for (const node of __turns.slice(-${lastN})) {
      const role = __roleOf(node);
      const text = __textOf(node);
      if (!text) continue;
      turns.push({
        turnIndex: index++,
        role: role === 'user' ? 'user' : 'assistant',
        markdownContent: text,
        codeBlocks: role === 'user' ? [] : __codeBlocksOf(node),
        contentHash: String(text.length),
      });
    }
    return { layoutVariant: 'chatgpt-2026-rolemarker', turns };
  })()`;
}

export function getChatGPTFingerprintExpr(promptLength: number): string {
  return `(() => {
    /* submitPrompt */
    ${CHATGPT_TRANSCRIPT_JS}
    const assistant = __lastAssistant();
    return {
      turnCount: __turns.length,
      lastTurnHash: assistant ? __textOf(assistant) : '',
      submittedPromptHash: String(${promptLength}),
    };
  })()`;
}

export function getChatGPTAwaitCompletionExpr(beforeTurnCount: number): string {
  return `(() => {
    /* awaitCompletion */
    ${IS_VISIBLE_JS}
    ${CHATGPT_TRANSCRIPT_JS}
    const stop = document.querySelector(${JSON.stringify(CHATGPT_STOP_SELECTOR)});
    const regen = document.querySelector('button[aria-label="Regenerate response"], button[data-testid="regenerate-button"]');
    const isGenerating = Boolean(stop && isVisible(stop) && !regen);

    const thought = document.querySelector('[data-testid*="thought"], [data-testid*="thinking"], [class*="thinking"]');
    const isThinking = Boolean(
      thought && (
        thought.querySelector('.animate-pulse, [class*="shimmer"], [class*="spin"], svg.animate-spin') ||
        (thought.innerText || '').includes('Thinking')
      )
    );

    const assistant = __lastAssistant();
    const assistantText = assistant ? __textOf(assistant) : '';
    // A user message alone is not a completion: the assistant turn must exist.
    const lastRole = __turns.length > 0 ? __roleOf(__turns[__turns.length - 1]) : null;
    const hasNewTurn = __turns.length > ${beforeTurnCount} && lastRole === 'assistant';

    return {
      turnsCount: __turns.length,
      hasNewTurn,
      isGenerating,
      isThinking,
      assistantText,
      codeBlocks: __codeBlocksOf(assistant),
    };
  })()`;
}
