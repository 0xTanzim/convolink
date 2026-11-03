import { IS_VISIBLE_JS } from "./driver-helpers.js";

export const GEMINI_RESOLVE_SELECTORS_EXPR = `(() => {
  /* resolveSelectors */
  const quill = document.querySelector('rich-textarea div.ql-editor, rich-textarea [contenteditable="true"], p[data-placeholder], div[contenteditable="true"].ql-editor');
  const send = document.querySelector('button[aria-label="Send message"], button.send-button, button[mattooltip="Send message"], button[aria-label*="Send"], button[aria-label*="Dictate"]');
  const stop = document.querySelector('button[aria-label="Stop response"], button[aria-label*="Stop"], mat-mdc-progress-spinner, mat-progress-spinner, .sparkle-thinking');
  const turns = document.querySelectorAll('user-query, model-response');
  return {
    ok: Boolean(quill && (send || quill.closest('rich-textarea, .input-area-container'))),
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

export function getGeminiFingerprintExpr(promptLength: number): string {
  return `(() => {
    /* submitPrompt */
    const beforeTurns = document.querySelectorAll('user-query, model-response').length;
    return { turnCount: beforeTurns, lastTurnHash: String(beforeTurns), submittedPromptHash: String(${promptLength}) };
  })()`;
}

export function getGeminiAwaitCompletionExpr(beforeTurnCount: number): string {
  return `(() => {
    /* awaitCompletion */
    ${IS_VISIBLE_JS}
    const stop = document.querySelector('button[aria-label="Stop response"], button[aria-label*="Stop"]');
    const spinner = document.querySelector('mat-mdc-progress-spinner, mat-progress-spinner, .processing-state-visible');
    const isGenerating = Boolean(
      (stop && isVisible(stop)) ||
      (spinner && isVisible(spinner))
    );

    const thoughtEl = document.querySelector('.sparkle-thinking, div[data-testid*="thought"], div[class*="thought"], button[aria-label*="Thinking"], button[aria-label*="thought"]');
    const isThinking = Boolean(
      thoughtEl && (
        thoughtEl.classList.contains('sparkle-thinking') ||
        thoughtEl.querySelector('mat-progress-spinner, mat-mdc-progress-spinner, [class*="spin"]') ||
        (thoughtEl.innerText || '').includes('Thinking...')
      )
    );

    const models = Array.from(document.querySelectorAll('model-response'));
    const turns = Array.from(document.querySelectorAll('user-query, model-response'));
    const lastTurn = turns.length > 0 ? turns[turns.length - 1] : null;
    const isLastModel = Boolean(lastTurn && lastTurn.tagName.toLowerCase() === 'model-response');
    const hasNewTurn = turns.length > ${beforeTurnCount} && isLastModel;
    const lastModel = models.length > 0 ? models[models.length - 1] : null;

    const contentNode = lastModel ? (lastModel.querySelector('message-content, .markdown, .model-response-text') || lastModel) : null;
    let assistantText = contentNode ? ((contentNode.innerText || contentNode.textContent) || '').trim() : '';
    assistantText = assistantText.replace(/^Show code\s*/i, '').replace(/^Gemini said\s*/i, '').trim();
    const codeBlocks = lastModel ? Array.from(lastModel.querySelectorAll('pre code')).map(c => ({
      language: c.className.replace(/^language-/, '') || 'text',
      code: c.textContent || '',
    })) : [];

    return { turnsCount: turns.length, hasNewTurn, isGenerating, isThinking, assistantText, codeBlocks };
  })()`;
}
