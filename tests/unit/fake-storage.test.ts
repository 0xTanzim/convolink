import { beforeEach, describe, expect, it } from "bun:test";
import { FakeThreadStore } from "../fakes/fake-storage.js";
import type { ThreadRecord } from "../../src/core/ports/storage.port.js";
import type { ConversationTurn } from "../../src/core/ports/platform.port.js";
import type { ContextPacket } from "../../src/core/ports/compiler.port.js";

describe("FakeThreadStore", () => {
  let store: FakeThreadStore;

  beforeEach(() => {
    store = new FakeThreadStore();
  });

  it("upserts and retrieves threads with platform filtering", async () => {
    const r1: ThreadRecord = {
      threadId: "t1", platform: "chatgpt", title: "ChatGPT Thread",
      url: "https://chatgpt.com/c/1", lastSyncedTurnCount: 1, updatedAt: "2026-10-31T10:00:00Z",
    };
    const r2: ThreadRecord = {
      threadId: "t2", platform: "deepseek", title: "DeepSeek Thread",
      url: "https://chat.deepseek.com/c/2", lastSyncedTurnCount: 1, updatedAt: "2026-10-31T11:00:00Z",
    };

    await store.upsertThread(r1);
    await store.upsertThread(r2);

    expect(await store.getThread("t1")).toEqual(r1);
    expect(await store.getThread("nonexistent")).toBeNull();

    const all = await store.listThreads();
    expect(all.length).toBe(2);
    expect(all[0]?.threadId).toBe("t2"); // Descending updatedAt

    const dsOnly = await store.listThreads("deepseek");
    expect(dsOnly.length).toBe(1);
    expect(dsOnly[0]?.threadId).toBe("t2");
  });

  it("appends and retrieves turns with index deduplication and lastNTurns slicing", async () => {
    const turnsBatch1: ConversationTurn[] = [
      { turnIndex: 0, role: "user", markdownContent: "Hello", contentHash: "h0", codeBlocks: [] },
      { turnIndex: 1, role: "assistant", markdownContent: "Hi there!", contentHash: "h1", codeBlocks: [] },
    ];
    await store.appendTurns("th-1", turnsBatch1);

    const turnsBatch2: ConversationTurn[] = [
      { turnIndex: 1, role: "assistant", markdownContent: "Updated Hi!", contentHash: "h1-new", codeBlocks: [] },
      { turnIndex: 2, role: "user", markdownContent: "How are you?", contentHash: "h2", codeBlocks: [] },
    ];
    await store.appendTurns("th-1", turnsBatch2);

    const allTurns = await store.getTurns("th-1");
    expect(allTurns.length).toBe(3);
    expect(allTurns[1]?.markdownContent).toBe("Updated Hi!");

    const sliced = await store.getTurns("th-1", 2);
    expect(sliced.length).toBe(2);
    expect(sliced[0]?.turnIndex).toBe(1);
    expect(sliced[1]?.turnIndex).toBe(2);
  });

  it("saves and retrieves compiled ContextPackets chronologically", async () => {
    const mockStructured = {
      activeInvariants: [],
      settledDecisions: [],
      discardedApproaches: [],
      canonicalInterfaces: [],
      immediateDirective: "none",
    };
    const p1: ContextPacket = {
      projectId: "proj-1", packetHash: "hash-1", sourceThreadId: "th-1",
      platform: "deepseek", sourceTurnRange: [0, 2], layoutVariant: "standard",
      compiledAt: "2026-10-31T09:00:00Z", markdownBody: "Body 1", structured: mockStructured,
    };
    const p2: ContextPacket = {
      projectId: "proj-1", packetHash: "hash-2", sourceThreadId: "th-1",
      platform: "deepseek", sourceTurnRange: [0, 4], layoutVariant: "standard",
      compiledAt: "2026-10-31T12:00:00Z", markdownBody: "Body 2", structured: mockStructured,
    };

    await store.savePacket(p1);
    await store.savePacket(p2);

    const latestByThread = await store.getLatestPacket("th-1");
    expect(latestByThread?.packetHash).toBe("hash-2");

    const latestByProj = await store.getLatestPacket("proj-1");
    expect(latestByProj?.packetHash).toBe("hash-2");

    expect(await store.getLatestPacket("unmatched")).toBeNull();
  });

  it("searches turns case-insensitively and returns snippets", async () => {
    await store.appendTurns("th-search", [
      { turnIndex: 0, role: "user", markdownContent: "Implement a Red-Black tree in TypeScript.", contentHash: "s1", codeBlocks: [] },
      { turnIndex: 1, role: "assistant", markdownContent: "Here is the Red-Black tree node definition...", contentHash: "s2", codeBlocks: [] },
    ]);

    const results = await store.searchTurns("red-black", 10);
    expect(results.length).toBe(2);
    expect(results[0]?.role).toBe("user");
    expect(results[0]?.snippet).toContain("Red-Black");
  });
});
