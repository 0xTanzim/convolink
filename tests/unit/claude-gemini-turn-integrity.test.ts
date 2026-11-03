import { describe, expect, it } from "bun:test";
import { getClaudeAwaitCompletionExpr } from "../../src/adapters/platforms/claude.scripts.js";
import { getGeminiAwaitCompletionExpr } from "../../src/adapters/platforms/gemini.scripts.js";

describe("Claude & Gemini Turn Detection Integrity", () => {
  it("Claude: requires an assistant turn and does not echo user messages", () => {
    const expr = getClaudeAwaitCompletionExpr(1);
    // Verify the script structure ensures that only assistant turns count as completion
    expect(expr).toContain("isLastAssistant");
    expect(expr).toContain("data-testid=\"user-message\"");
  });

  it("Gemini: requires the latest turn to be a model-response", () => {
    const expr = getGeminiAwaitCompletionExpr(1);
    // Verify the script ensures that a user query does not trigger hasNewTurn
    expect(expr).toContain("isLastModel");
    expect(expr).toContain("model-response");
  });
});
