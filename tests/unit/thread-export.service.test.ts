import { describe, expect, it } from "bun:test";
import { ThreadExportService } from "../../src/core/services/thread-export.service.js";
import type { ThreadRecord } from "../../src/core/ports/storage.port.js";
import type { ConversationTurn } from "../../src/core/ports/platform.port.js";

describe("ThreadExportService", () => {
  const sampleRecord: ThreadRecord = {
    threadId: "th-abc-123",
    platform: "deepseek",
    title: "Rust Async Architecture",
    url: "https://chat.deepseek.com/a/chat/s/th-abc-123",
    lastSyncedTurnCount: 2,
    updatedAt: "2026-10-31T12:00:00.000Z",
  };

  const sampleTurns: ConversationTurn[] = [
    {
      turnIndex: 0,
      role: "user",
      markdownContent: "Explain Tokio task spawning.",
      contentHash: "hash-turn-0",
      codeBlocks: [],
    },
    {
      turnIndex: 1,
      role: "assistant",
      markdownContent: "Here is an example using `tokio::spawn`:\n```rust\ntokio::spawn(async {});\n```",
      contentHash: "hash-turn-1",
      codeBlocks: [
        { language: "rust", code: "tokio::spawn(async {});" },
      ],
    },
  ];

  it("formatMarkdown generates structured Markdown header and turn sections", () => {
    const md = ThreadExportService.formatMarkdown(sampleRecord, sampleTurns);

    expect(md).toContain("# Conversation Ledger: Rust Async Architecture");
    expect(md).toContain("- **Thread ID:** `th-abc-123`");
    expect(md).toContain("- **Platform:** `deepseek`");
    expect(md).toContain("- **URL:** [https://chat.deepseek.com/a/chat/s/th-abc-123]");
    expect(md).toContain("- **Turn Count:** 2");

    expect(md).toContain("### 👤 User (Turn 0)");
    expect(md).toContain("Explain Tokio task spawning.");

    expect(md).toContain("### 🤖 Assistant (Turn 1)");
    expect(md).toContain("*Contained 1 code block(s)*");
  });

  it("formatJson produces valid JSON representation containing thread and turns", () => {
    const jsonStr = ThreadExportService.formatJson(sampleRecord, sampleTurns);
    const parsed = JSON.parse(jsonStr);

    expect(parsed.thread.threadId).toBe("th-abc-123");
    expect(parsed.thread.platform).toBe("deepseek");
    expect(parsed.turns.length).toBe(2);
    expect(parsed.turns[0].role).toBe("user");
    expect(parsed.turns[1].role).toBe("assistant");
    expect(parsed.turns[1].codeBlocks.length).toBe(1);
  });
});
