export type PlatformKey = "chatgpt" | "claude" | "deepseek" | "gemini";

export interface PlatformSelectors {
  readonly turns: string;
  readonly user: string;
  readonly assistant: string;
  readonly stop: string;
  readonly thinking: string;
  readonly composer: string;
  readonly send: string;
}

/**
 * Selectors are data, not code: the operation functions receive them as
 * arguments because `chrome.scripting.executeScript` cannot capture module
 * scope when it serializes a function into the page.
 */
export const PLATFORM_SELECTORS: Record<PlatformKey, PlatformSelectors> = {
  chatgpt: {
    turns: "article[data-testid^='conversation-turn-']",
    user: "[data-message-author-role='user']",
    assistant: "[data-message-author-role='assistant']",
    stop: "button[data-testid='stop-button'], button[aria-label*='Stop']",
    thinking: "[data-testid='reasoning'], .reasoning",
    composer: "div.ProseMirror[contenteditable='true'], #prompt-textarea, div[contenteditable='true']",
    send: "button[data-testid='send-button'], button[aria-label='Send prompt'], button[aria-label='Send']",
  },
  claude: {
    turns: "[data-testid='chat-message']",
    user: ".font-user-message, [data-testid='user-message']",
    assistant: ".font-claude-message, [data-testid='assistant-message']",
    stop: "button[aria-label*='Stop'], button[aria-label*='stop']",
    thinking: "[data-testid='thinking'], .thinking-block",
    composer: "div[contenteditable='true'].ProseMirror, div[contenteditable='true']",
    send: "button[aria-label='Send Message'], button[aria-label*='Send'], button[type='submit']",
  },
  deepseek: {
    turns: ".ds-message",
    user: "[class*='user'], .fbb737a4",
    assistant: ".ds-markdown, [class*='assistant']",
    stop: ".ds-button--stop, button[aria-label*='stop'], button[aria-label*='Stop']",
    thinking: ".ds-think-content, [class*='thinking']",
    composer: "textarea#chat-input, textarea, div[contenteditable='true']",
    send: "div[role='button'].ds-button--circle, div.ds-button--circle, button[aria-label*='send'], div.send-button",
  },
  gemini: {
    turns: "user-query, model-response, .conversation-container",
    user: "user-query, .user-query",
    assistant: "model-response, .model-response-text, .markdown",
    stop: "button[aria-label*='Stop'], button.stop-button",
    thinking: "model-thoughts, .thinking",
    composer: "rich-textarea div.ql-editor.textarea, rich-textarea [contenteditable='true'], p[data-placeholder], div[contenteditable='true'].ql-editor",
    send: "button[aria-label='Send message'], button.send-button, button[mattooltip='Send message'], button[aria-label*='Send']",
  },
};

export function platformForUrl(url: string): PlatformKey | null {
  if (url.includes("chatgpt.com") || url.includes("chat.openai.com")) return "chatgpt";
  if (url.includes("claude.ai")) return "claude";
  if (url.includes("chat.deepseek.com")) return "deepseek";
  if (url.includes("gemini.google.com")) return "gemini";
  return null;
}
