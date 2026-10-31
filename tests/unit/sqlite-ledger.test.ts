import { describe, expect, it } from "bun:test";
import { SqliteLedgerAdapter } from "../../src/adapters/storage/sqlite-ledger.adapter.js";
import type { ThreadRecord } from "../../src/core/ports/storage.port.js";
import type { ConversationTurn } from "../../src/core/ports/platform.port.js";
import type { ContextPacket } from "../../src/core/ports/compiler.port.js";

describe("SqliteLedgerAdapter", () => {
  it("initializes in-memory database and upserts threads", async () => {
    const store = new SqliteLedgerAdapter(":memory:");

    const record: ThreadRecord = {
      threadId: "t-101",
      platform: "deepseek",
      title: "Rust Architecture Chat",
      url: "https://chat.deepseek.com/a/chat/s/t-101",
      lastSyncedTurnCount: 4,
      updatedAt: new Date().toISOString(),
    };

    await store.upsertThread(record);
    const threads = await store.listThreads("deepseek");

    expect(threads.length).toBe(1);
    expect(threads[0]?.threadId).toBe("t-101");
    expect(threads[0]?.title).toBe("Rust Architecture Chat");
    expect(threads[0]?.platform).toBe("deepseek");

    store.close();
  });

  it("appends and retrieves conversation turns with code blocks preserved", async () => {
    const store = new SqliteLedgerAdapter(":memory:");

    const turns: ConversationTurn[] = [
      {
        turnIndex: 0,
        role: "user",
        markdownContent: "Explain atomics in Zig",
        codeBlocks: [],
        contentHash: "h-u0",
      },
      {
        turnIndex: 1,
        role: "assistant",
        markdownContent: "Here is an atomic counter:\n```zig\nconst std = @import(\"std\");\n```",
        codeBlocks: [{ language: "zig", code: "const std = @import(\"std\");" }],
        contentHash: "h-a1",
      },
    ];

    await store.appendTurns("thread-zig", turns);
    const retrieved = await store.getTurns("thread-zig");

    expect(retrieved.length).toBe(2);
    expect(retrieved[0]?.role).toBe("user");
    expect(retrieved[1]?.role).toBe("assistant");
    expect(retrieved[1]?.codeBlocks.length).toBe(1);
    expect(retrieved[1]?.codeBlocks[0]?.language).toBe("zig");
    expect(retrieved[1]?.codeBlocks[0]?.code).toContain("@import");

    // Test lastNTurns limit
    const lastOne = await store.getTurns("thread-zig", 1);
    expect(lastOne.length).toBe(1);
    expect(lastOne[0]?.turnIndex).toBe(1);

    store.close();
  });

  it("saves and retrieves compiled ContextPackets", async () => {
    const store = new SqliteLedgerAdapter(":memory:");

    const packet: ContextPacket = {
      projectId: "proj-alpha",
      packetHash: "sha256-hash-99",
      sourceThreadId: "thread-zig",
      platform: "deepseek",
      sourceTurnRange: [0, 1],
      layoutVariant: "deepseek-standard-v1",
      compiledAt: new Date().toISOString(),
      markdownBody: "# Compiled Project Spec\n\n- Invariant: lock-free only",
      structured: {
        activeInvariants: ["lock-free only"],
        settledDecisions: ["Use AtomicUsize"],
        discardedApproaches: ["Mutex"],
        canonicalInterfaces: [{ language: "zig", code: "pub const Counter = struct {};" }],
        immediateDirective: "Implement fetch_add",
      },
    };

    await store.savePacket(packet);
    const retrieved = await store.getLatestPacket("thread-zig");

    expect(retrieved).not.toBeNull();
    expect(retrieved?.packetHash).toBe("sha256-hash-99");
    expect(retrieved?.markdownBody).toContain("Compiled Project Spec");
    expect(retrieved?.structured.activeInvariants[0]).toBe("lock-free only");

    store.close();
  });

  it("indexes turns and performs full-text search with ranking and snippets", async () => {
    const store = new SqliteLedgerAdapter(":memory:");

    await store.appendTurns("thread-search", [
      {
        turnIndex: 0,
        role: "user",
        markdownContent: "How do we implement Hexagonal Architecture?",
        codeBlocks: [],
        contentHash: "h1",
      },
      {
        turnIndex: 1,
        role: "assistant",
        markdownContent: "Hexagonal architecture uses ports and adapters to isolate core domain logic from external side effects.",
        codeBlocks: [{ language: "ts", code: "export interface StoragePort {}" }],
        contentHash: "h2",
      },
      {
        turnIndex: 2,
        role: "user",
        markdownContent: "What is an event loop in Node.js?",
        codeBlocks: [],
        contentHash: "h3",
      },
    ]);

    const results = await store.searchTurns("Hexagonal");
    expect(results.length).toBe(2);
    expect(results[0]?.threadId).toBe("thread-search");
    expect(results[0]?.snippet.toLowerCase()).toContain("hexagonal");

    const codeResults = await store.searchTurns("StoragePort");
    expect(codeResults.length).toBe(1);
    expect(codeResults[0]?.turnIndex).toBe(1);

    store.close();
  });
});
