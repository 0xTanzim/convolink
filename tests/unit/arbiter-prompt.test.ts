import { describe, expect, it, test } from "bun:test";
import { ArbiterPromptBuilder } from "../../src/core/services/arbiter-prompt.builder.js";
import type { ModelExecutionResult } from "../../src/core/services/comparison.types.js";
import type { DiscoveredTab } from "../../src/core/services/orchestrator.types.js";

describe("ArbiterPromptBuilder", () => {
  const dummyTab: DiscoveredTab = {
    targetId: "t1",
    url: "https://chatgpt.com",
    title: "ChatGPT",
    platformId: "chatgpt",
    threadId: null,
  };

  it("builds a structured arbitration prompt with candidates and synthesis instructions", () => {
    const results: ModelExecutionResult[] = [
      {
        platform: "chatgpt",
        tab: dummyTab,
        status: "success",
        elapsedMs: 1200,
        turn: {
          turnIndex: 1,
          role: "assistant",
          markdownContent: "ChatGPT solution: use a Map with delete/set",
          codeBlocks: [{ language: "ts", code: "class LRU {}" }],
          contentHash: "h1",
        },
      },
      {
        platform: "deepseek",
        tab: { ...dummyTab, platformId: "deepseek", url: "https://chat.deepseek.com" },
        status: "success",
        elapsedMs: 800,
        turn: {
          turnIndex: 1,
          role: "assistant",
          markdownContent: "DeepSeek solution: use doubly-linked list with hash map",
          codeBlocks: [{ language: "ts", code: "class Node {}\nclass DoublyLinkedList {}" }],
          contentHash: "h2",
        },
      },
    ];

    const prompt = ArbiterPromptBuilder.build({
      originalPrompt: "Implement an LRU cache in TypeScript",
      candidateResults: results,
    });

    expect(prompt).toContain("Technical Arbiter");
    expect(prompt).toContain("Implement an LRU cache in TypeScript");
    expect(prompt).toContain("Candidate 1 (Platform: ChatGPT)");
    expect(prompt).toContain("Candidate 2 (Platform: DeepSeek)");
    expect(prompt).toContain("ChatGPT solution: use a Map with delete/set");
    expect(prompt).toContain("DeepSeek solution: use doubly-linked list with hash map");
    expect(prompt).toContain("Synthesized Production Solution");
  });

  it("filters out failed candidates and includes only successful responses", () => {
    const results: ModelExecutionResult[] = [
      {
        platform: "chatgpt",
        tab: dummyTab,
        status: "success",
        elapsedMs: 1200,
        turn: {
          turnIndex: 1,
          role: "assistant",
          markdownContent: "Valid solution",
          codeBlocks: [],
          contentHash: "h3",
        },
      },
      {
        platform: "gemini",
        tab: { ...dummyTab, platformId: "gemini" },
        status: "failed",
        elapsedMs: 400,
        error: "Network timeout",
      },
    ];

    const prompt = ArbiterPromptBuilder.build({
      originalPrompt: "Fix bug",
      candidateResults: results,
    });

    expect(prompt).toContain("Candidate 1 (Platform: ChatGPT)");
    expect(prompt).not.toContain("Candidate 2 (Platform: Gemini)");
  });

  it("throws error if there are no successful candidates to arbitrate", () => {
    expect(() => {
      ArbiterPromptBuilder.build({
        originalPrompt: "Do something",
        candidateResults: [],
      });
    }).toThrow("Cannot arbitrate without at least one successful candidate solution");
  });

  it("anonymizes candidate platforms and redacts brand tags when anonymize is true", () => {
    const results: ModelExecutionResult[] = [
      {
        platform: "chatgpt",
        tab: dummyTab,
        status: "success",
        elapsedMs: 1200,
        turn: {
          turnIndex: 1,
          role: "assistant",
          markdownContent: "ChatGPT says: here is the code from OpenAI.",
          codeBlocks: [],
          contentHash: "h1",
        },
      },
      {
        platform: "claude",
        tab: { ...dummyTab, platformId: "claude" },
        status: "success",
        elapsedMs: 900,
        turn: {
          turnIndex: 1,
          role: "assistant",
          markdownContent: "Claude solution: here is the code from Anthropic.",
          codeBlocks: [],
          contentHash: "h2",
        },
      },
    ];

    const prompt = ArbiterPromptBuilder.build({
      originalPrompt: "Optimize algorithm",
      candidateResults: results,
      anonymize: true,
    });

    expect(prompt).toContain("### Candidate A");
    expect(prompt).toContain("### Candidate B");
    expect(prompt).not.toContain("Candidate 1 (Platform: ChatGPT)");
    expect(prompt).not.toContain("Candidate 2 (Platform: Claude)");
    expect(prompt).toContain("Crux-of-Disagreement Extraction");
  });

  test("arbitrates contemporary November 2026 frontier platforms (GPT-6, Claude Opus 5.5, DeepSeek v4, Gemini 4)", () => {
    const results: ModelExecutionResult[] = [
      {
        platform: "chatgpt",
        tab: { ...dummyTab, platformId: "chatgpt", title: "GPT-6 Asta" },
        status: "success",
        elapsedMs: 850,
        turn: {
          turnIndex: 1,
          role: "assistant",
          markdownContent: "GPT-6 Asta proposal: lock-free concurrency via atomic primitives.",
          codeBlocks: [],
          contentHash: "asta_1",
        },
      },
      {
        platform: "claude",
        tab: { ...dummyTab, platformId: "claude", title: "Claude Opus 5.5" },
        status: "success",
        elapsedMs: 920,
        turn: {
          turnIndex: 1,
          role: "assistant",
          markdownContent: "Claude Opus 5.5 proposal: actor model with mailbox isolation.",
          codeBlocks: [],
          contentHash: "opus_1",
        },
      },
      {
        platform: "deepseek",
        tab: { ...dummyTab, platformId: "deepseek", title: "DeepSeek v4.1 Flash" },
        status: "success",
        elapsedMs: 650,
        turn: {
          turnIndex: 1,
          role: "assistant",
          markdownContent: "DeepSeek v4.1 Flash proposal: hierarchical work-stealing deque.",
          codeBlocks: [],
          contentHash: "v4_1",
        },
      },
      {
        platform: "gemini",
        tab: { ...dummyTab, platformId: "gemini", title: "Gemini 4 Carbon" },
        status: "success",
        elapsedMs: 780,
        turn: {
          turnIndex: 1,
          role: "assistant",
          markdownContent: "Gemini 4 Carbon proposal: vectorized pipelined batch execution.",
          codeBlocks: [],
          contentHash: "gem_1",
        },
      },
    ];

    const prompt = ArbiterPromptBuilder.build({
      originalPrompt: "Architect high-throughput concurrency engine",
      candidateResults: results,
      anonymize: true,
    });

    expect(prompt).toContain("### Candidate A");
    expect(prompt).toContain("### Candidate B");
    expect(prompt).toContain("### Candidate C");
    expect(prompt).toContain("### Candidate D");
    expect(prompt).toContain("Crux-of-Disagreement Extraction");
    expect(prompt).toContain("Synthesized Production Solution");
  });
});
