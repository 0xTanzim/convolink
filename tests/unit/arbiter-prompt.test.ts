import { describe, expect, it } from "bun:test";
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
});
