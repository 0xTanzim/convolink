import { describe, expect, it } from "bun:test";
import { ComparisonEngineService } from "../../src/core/services/comparison-engine.service.js";
import type { DiscoveredTab, AskResult } from "../../src/core/services/orchestrator.types.js";

describe("ComparisonEngineService", () => {
  const tabChatGPT: DiscoveredTab = {
    targetId: "tab-chatgpt",
    title: "ChatGPT",
    url: "https://chatgpt.com/",
    platformId: "chatgpt",
    threadId: "default",
  };

  const tabDeepSeek: DiscoveredTab = {
    targetId: "tab-deepseek",
    title: "DeepSeek",
    url: "https://chat.deepseek.com/",
    platformId: "deepseek",
    threadId: "default",
  };

  const mockAskRunner = async (tab: DiscoveredTab, prompt: string): Promise<AskResult> => {
    if (tab.platformId === "chatgpt") {
      return {
        tab,
        turn: { turnIndex: 0, role: "assistant", markdownContent: "ChatGPT solution", codeBlocks: [{ language: "ts", code: "const a = 1;" }], contentHash: "1" },
        elapsedMs: 200,
        riskLabels: [],
        redactedSecretsCount: 0,
      };
    }
    if (tab.platformId === "deepseek") {
      return {
        tab,
        turn: { turnIndex: 0, role: "assistant", markdownContent: "DeepSeek solution", codeBlocks: [{ language: "ts", code: "const b = 2;" }], contentHash: "2" },
        elapsedMs: 150,
        riskLabels: [],
        redactedSecretsCount: 0,
      };
    }
    throw new Error(`Unknown platform ${tab.platformId}`);
  };

  it("runs parallel comparison across multiple tabs and collects results", async () => {
    const engine = new ComparisonEngineService(mockAskRunner);
    const results = await engine.executeComparison({
      prompt: "Design Redis cache",
      tabs: [tabChatGPT, tabDeepSeek],
      mode: "parallel",
      staggerMs: 10,
    });

    expect(results.length).toBe(2);
    expect(results.find((r) => r.platform === "chatgpt")?.status).toBe("success");
    expect(results.find((r) => r.platform === "deepseek")?.status).toBe("success");
    expect(results.find((r) => r.platform === "chatgpt")?.turn?.markdownContent).toBe("ChatGPT solution");
  });

  it("handles partial failure without aborting other models", async () => {
    const failingAskRunner = async (tab: DiscoveredTab, prompt: string): Promise<AskResult> => {
      if (tab.platformId === "deepseek") {
        throw new Error("DeepSeek model rate limited");
      }
      return mockAskRunner(tab, prompt);
    };

    const engine = new ComparisonEngineService(failingAskRunner);
    const results = await engine.executeComparison({
      prompt: "Design Redis cache",
      tabs: [tabChatGPT, tabDeepSeek],
      mode: "parallel",
      staggerMs: 10,
    });

    expect(results.length).toBe(2);
    const chatgptRes = results.find((r) => r.platform === "chatgpt");
    const deepseekRes = results.find((r) => r.platform === "deepseek");

    expect(chatgptRes?.status).toBe("success");
    expect(deepseekRes?.status).toBe("failed");
    expect(deepseekRes?.error).toContain("rate limited");
  });

  it("supports sequential execution mode", async () => {
    const executionOrder: string[] = [];
    const trackingRunner = async (tab: DiscoveredTab, prompt: string): Promise<AskResult> => {
      executionOrder.push(tab.platformId!);
      return mockAskRunner(tab, prompt);
    };

    const engine = new ComparisonEngineService(trackingRunner);
    const results = await engine.executeComparison({
      prompt: "Analyze deadlock",
      tabs: [tabChatGPT, tabDeepSeek],
      mode: "sequential",
    });

    expect(results.length).toBe(2);
    expect(executionOrder).toEqual(["chatgpt", "deepseek"]);
  });
});
