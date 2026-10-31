import { describe, expect, it } from "bun:test";
import { ComparisonEngineService } from "../../src/core/services/comparison-engine.service.js";
import type { DiscoveredTab, AskResult } from "../../src/core/services/orchestrator.types.js";

describe("ComparisonEngineService Arbitration", () => {
  const tabs: DiscoveredTab[] = [
    { targetId: "t-chatgpt", url: "https://chatgpt.com", title: "ChatGPT", platformId: "chatgpt", threadId: null },
    { targetId: "t-deepseek", url: "https://chat.deepseek.com", title: "DeepSeek", platformId: "deepseek", threadId: null },
  ];

  it("executes stage 1 parallel comparison followed by stage 2 arbitration", async () => {
    const receivedPrompts: string[] = [];

    const mockAsk = async (tab: DiscoveredTab, prompt: string): Promise<AskResult> => {
      receivedPrompts.push(prompt);
      if (prompt.includes("Technical Arbiter")) {
        return {
          tab,
          turn: {
            turnIndex: 2,
            role: "assistant",
            markdownContent: "Arbiter Synthesis: DeepSeek algorithm with ChatGPT ergonomics",
            codeBlocks: [{ language: "typescript", code: "export class UnifiedSolution {}" }],
            contentHash: "h-arb",
          },
          artifacts: [],
          elapsedMs: 600,
          riskLabels: [],
          redactedSecretsCount: 0,
        };
      }
      return {
        tab,
        turn: {
          turnIndex: 1,
          role: "assistant",
          markdownContent: `Answer from ${tab.platformId}`,
          codeBlocks: [],
          contentHash: "h-ans",
        },
        artifacts: [],
        elapsedMs: 250,
        riskLabels: [],
        redactedSecretsCount: 0,
      };
    };

    const engine = new ComparisonEngineService(mockAsk);
    const output = await engine.executeComparisonWithArbitration({
      prompt: "Design a rate limiter",
      tabs,
      arbitrate: true,
      arbiter: "deepseek",
    });

    expect(output.results.length).toBe(2);
    expect(output.results[0]?.status).toBe("success");
    expect(output.results[1]?.status).toBe("success");

    expect(output.arbitration).toBeDefined();
    expect(output.arbitration?.arbiterPlatform).toBe("deepseek");
    expect(output.arbitration?.status).toBe("success");
    expect(output.arbitration?.turn?.markdownContent).toContain("Arbiter Synthesis");
    expect(receivedPrompts.length).toBe(3); // 2 candidate asks + 1 arbiter ask
    expect(receivedPrompts[2]).toContain("Technical Arbiter");
  });

  it("handles arbitration gracefully when one model fails during stage 1", async () => {
    const mockAsk = async (tab: DiscoveredTab, prompt: string): Promise<AskResult> => {
      if (tab.platformId === "chatgpt") {
        throw new Error("ChatGPT timeout");
      }
      if (prompt.includes("Technical Arbiter")) {
        return {
          tab,
          turn: {
            turnIndex: 2,
            role: "assistant",
            markdownContent: "Arbiter evaluated 1 successful candidate",
            codeBlocks: [],
            contentHash: "h-arb-single",
          },
          artifacts: [],
          elapsedMs: 400,
          riskLabels: [],
          redactedSecretsCount: 0,
        };
      }
      return {
        tab,
        turn: {
          turnIndex: 1,
          role: "assistant",
          markdownContent: "DeepSeek standalone",
          codeBlocks: [],
          contentHash: "h-ds",
        },
        artifacts: [],
        elapsedMs: 300,
        riskLabels: [],
        redactedSecretsCount: 0,
      };
    };

    const engine = new ComparisonEngineService(mockAsk);
    const output = await engine.executeComparisonWithArbitration({
      prompt: "Design a cache",
      tabs,
      arbitrate: true,
    });

    expect(output.results.length).toBe(2);
    expect(output.results[0]?.status).toBe("failed");
    expect(output.results[1]?.status).toBe("success");

    expect(output.arbitration).toBeDefined();
    expect(output.arbitration?.status).toBe("success");
    expect(output.arbitration?.turn?.markdownContent).toContain("Arbiter evaluated 1 successful candidate");
  });
});
