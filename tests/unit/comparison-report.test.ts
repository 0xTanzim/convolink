import { describe, expect, it } from "bun:test";
import { ComparisonReportService } from "../../src/core/services/comparison-report.service.js";
import type { ModelExecutionResult } from "../../src/core/services/comparison.types.js";

describe("ComparisonReportService", () => {
  const mockResults: ModelExecutionResult[] = [
    {
      platform: "deepseek",
      tab: { targetId: "t1", title: "DeepSeek", url: "https://chat.deepseek.com", platformId: "deepseek", threadId: "1" },
      status: "success",
      elapsedMs: 1400,
      turn: {
        turnIndex: 0,
        role: "assistant",
        markdownContent: "DeepSeek output with code.\n```ts\nconst x = 10;\nconst y = 20;\n```",
        codeBlocks: [{ language: "ts", code: "const x = 10;\nconst y = 20;" }],
        contentHash: "h1",
      },
    },
    {
      platform: "chatgpt",
      tab: { targetId: "t2", title: "ChatGPT", url: "https://chatgpt.com", platformId: "chatgpt", threadId: "2" },
      status: "success",
      elapsedMs: 2100,
      turn: {
        turnIndex: 0,
        role: "assistant",
        markdownContent: "ChatGPT output without code.",
        codeBlocks: [],
        contentHash: "h2",
      },
    },
    {
      platform: "gemini",
      tab: { targetId: "t3", title: "Gemini", url: "https://gemini.google.com", platformId: "gemini", threadId: "3" },
      status: "failed",
      elapsedMs: 500,
      error: "Timeout waiting for model",
    },
  ];

  it("computes accurate platform metrics from results", () => {
    const service = new ComparisonReportService();
    const metrics = service.computeMetrics(mockResults);

    expect(metrics.length).toBe(3);

    const ds = metrics.find((m) => m.platform === "deepseek");
    expect(ds?.status).toBe("success");
    expect(ds?.codeBlockCount).toBe(1);
    expect(ds?.totalLinesOfCode).toBe(2);
    expect(ds?.elapsedMs).toBe(1400);

    const gpt = metrics.find((m) => m.platform === "chatgpt");
    expect(gpt?.codeBlockCount).toBe(0);
    expect(gpt?.totalLinesOfCode).toBe(0);

    const gem = metrics.find((m) => m.platform === "gemini");
    expect(gem?.status).toBe("failed");
  });

  it("identifies the fastest successful platform", () => {
    const service = new ComparisonReportService();
    const metrics = service.computeMetrics(mockResults);
    const fastest = service.determineFastestPlatform(metrics);

    expect(fastest).toBe("deepseek");
  });

  it("builds a structured Markdown comparison matrix", () => {
    const service = new ComparisonReportService();
    const metrics = service.computeMetrics(mockResults);
    const report = service.buildMarkdownReport("cmp-123", "Design auth cache", mockResults, metrics, "parallel");

    expect(report).toContain("# Multi-Model Comparison: Design auth cache");
    expect(report).toContain("cmp-123");
    expect(report).toContain("DeepSeek");
    expect(report).toContain("ChatGPT");
    expect(report).toContain("Gemini");
    expect(report).toContain("| **DeepSeek** | ✅ Done | 1.4s");
    expect(report).toContain("| **Gemini** | ❌ Failed");
  });

  it("renders the Technical Arbiter Synthesis section when arbitration result is present", () => {
    const service = new ComparisonReportService();
    const metrics = service.computeMetrics(mockResults);
    const report = service.buildMarkdownReport("cmp-456", "Refactor lock", mockResults, metrics, "parallel", {
      arbiterPlatform: "deepseek",
      status: "success",
      elapsedMs: 1800,
      turn: {
        turnIndex: 2,
        role: "assistant",
        markdownContent: "Unified Production Consensus: Combines Map lock with atomics.",
        codeBlocks: [{ language: "ts", code: "export class LockFreeSync {}" }],
        contentHash: "h-arb-rep",
      },
    });

    expect(report).toContain("Technical Arbiter Synthesis (DeepSeek)");
    expect(report).toContain("Unified Production Consensus: Combines Map lock with atomics.");
    expect(report).toContain("1.8s");
  });
});
