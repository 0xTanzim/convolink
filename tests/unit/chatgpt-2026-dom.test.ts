import { describe, expect, it } from "bun:test";
import {
  CHATGPT_SEND_SELECTOR,
  CHATGPT_STOP_SELECTOR,
  getChatGPTAwaitCompletionExpr,
  getChatGPTReadThreadExpr,
} from "../../src/adapters/platforms/chatgpt.scripts.js";

// The 2026 ChatGPT transcript dropped article/turn containers in favour of
// role markers. These assertions lock the contract that was discovered live.
describe("ChatGPT 2026 transcript selectors", () => {
  it("anchors the transcript on role markers, never on hashed classes", () => {
    const read = getChatGPTReadThreadExpr(10);
    const status = getChatGPTAwaitCompletionExpr(0);
    for (const expression of [read, status]) {
      expect(expression).toContain("[data-conversation-role]");
      expect(expression).not.toContain("block-BQZwFn");
    }
  });

  it("requires an assistant turn before reporting a completion", () => {
    expect(getChatGPTAwaitCompletionExpr(0)).toContain("lastRole === 'assistant'");
  });

  it("targets the real send control by aria-label", () => {
    expect(CHATGPT_SEND_SELECTOR).toContain('button[aria-label="Send"]');
  });

  it("does not confuse a Stop control with dictation", () => {
    expect(CHATGPT_STOP_SELECTOR).toContain('not([aria-label*="dictation" i])');
  });
});
