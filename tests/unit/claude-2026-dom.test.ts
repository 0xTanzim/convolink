import { describe, expect, it } from "bun:test";
import { PLATFORM_SELECTORS } from "../../extensions/convolink-companion/entrypoints/platforms.js";
import { statusOp } from "../../extensions/convolink-companion/entrypoints/operations.js";

// The 2026 Claude transcript has one container per role and keeps a
// data-is-streaming flag on the assistant container. `chat-message` is gone.
describe("Claude 2026 transcript selectors", () => {
  it("anchors on the role testids instead of the removed chat-message container", () => {
    const claude = PLATFORM_SELECTORS.claude;
    expect(claude.turns).toContain("[data-testid='user-message']");
    expect(claude.turns).toContain("[data-testid='assistant-message']");
    expect(claude.turns).not.toContain("chat-message");
    expect(claude.assistant).toContain("[data-testid='assistant-message']");
  });

  it("keeps the DeepSeek and ChatGPT tables unchanged", () => {
    expect(PLATFORM_SELECTORS.chatgpt.turns).toBe("[data-conversation-role]");
    expect(PLATFORM_SELECTORS.deepseek.assistant).toBe(".ds-markdown, [class*='assistant']");
  });
});

describe("statusOp turn rules", () => {
  it("decides a new turn from the last role even without a role attribute", () => {
    const source = statusOp.toString();
    expect(source).toContain("lastRole ? lastRole === \"assistant\" : !roleAttr");
  });

  it("does not treat a mounted but disabled stop control as generating", () => {
    const source = statusOp.toString();
    // Bun transpiles the function, so assert on stable fragments only.
    expect(source).toContain("visibleInPage(stop)");
    expect(source).toContain(".disabled ===");
    expect(source).toContain("aria-disabled");
  });

  it("removes screen-reader labels and icon-font glyphs from the answer text", () => {
    const source = statusOp.toString();
    expect(source).toContain("sr-only");
    expect(source).toContain("\\uE000-\\uF8FF");
    expect(source).toContain("standard-markdown");
  });
});
