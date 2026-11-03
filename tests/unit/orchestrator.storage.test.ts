import { describe, expect, it } from "bun:test";
import { recordManagedTab } from "../../src/adapters/browsers/tab-registry.js";
import { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { PolicyService } from "../../src/core/services/policy.service.js";
import { SqliteLedgerAdapter } from "../../src/adapters/storage/sqlite-ledger.adapter.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
process.env.XDG_RUNTIME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "convo-runtime-"));

describe("SessionOrchestrator Durable Ledger (Resume & Export)", () => {
  it("automatically records turns to the thread store during ask", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("resolveSelectors", {
      ok: true, layoutVariant: "v1", composerSelector: "textarea", sendButtonSelector: "button",
      stopIndicatorSelector: null, turnContainerSelector: ".turn",
    });
    browser.evalResponseMap.set("awaitCompletion", {
      mdCount: 1, hasNewTurn: true, isGenerating: false, turnIndex: 0,
      text: "Persisted turn output", codeBlocks: [{ language: "ts", code: "const x = 1;" }],
    });

    const store = new SqliteLedgerAdapter(":memory:");
    const orchestrator = new SessionOrchestrator({
      browser,
      drivers: [new DeepSeekDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
      threadStore: store,
    });

    await orchestrator.ask({ prompt: "Hello persistence", platform: "deepseek" });

    const threads = await store.listThreads("deepseek");
    expect(threads.length).toBe(1);
    expect(threads[0]?.title).toContain("chat.deepseek.com");

    const turns = await store.getTurns(threads[0]!.threadId);
    expect(turns.length).toBe(2);
    expect(turns[0]?.role).toBe("user");
    expect(turns[0]?.markdownContent).toBe("Hello persistence");
    expect(turns[0]?.turnIndex).toBe(0);
    expect(turns[1]?.role).toBe("assistant");
    expect(turns[1]?.markdownContent).toContain("Persisted turn output");
    expect(turns[1]?.turnIndex).toBe(1);

    store.close();
  });

  it("exports thread turns as formatted Markdown", async () => {
    const browser = new FakeBrowserPort();
    const store = new SqliteLedgerAdapter(":memory:");

    await store.upsertThread({
      threadId: "t-persisted-1",
      platform: "deepseek",
      title: "Architecture Session",
      url: "https://chat.deepseek.com/a/chat/s/t-persisted-1",
      lastSyncedTurnCount: 2,
      updatedAt: new Date().toISOString(),
    });

    await store.appendTurns("t-persisted-1", [
      { turnIndex: 0, role: "user", markdownContent: "What is Raft?", codeBlocks: [], contentHash: "h0" },
      { turnIndex: 1, role: "assistant", markdownContent: "Raft is a consensus algorithm.", codeBlocks: [], contentHash: "h1" },
    ]);

    const orchestrator = new SessionOrchestrator({
      browser,
      drivers: [new DeepSeekDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
      threadStore: store,
    });

    const md = await orchestrator.exportThread("t-persisted-1", "markdown");
    expect(md).toContain("# Conversation Ledger: Architecture Session");
    expect(md).toContain("What is Raft?");
    expect(md).toContain("Raft is a consensus algorithm.");

    const json = await orchestrator.exportThread("t-persisted-1", "json");
    expect(JSON.parse(json).turns.length).toBe(2);

    store.close();
  });

  it("resumes a thread by re-opening its saved thread URL", async () => {
    const browser = new FakeBrowserPort();
    const store = new SqliteLedgerAdapter(":memory:");

    await store.upsertThread({
      threadId: "t-resume-2",
      platform: "deepseek",
      title: "Distributed Lock Session",
      url: "https://chat.deepseek.com/a/chat/s/t-resume-2",
      lastSyncedTurnCount: 1,
      updatedAt: new Date().toISOString(),
    });

    const orchestrator = new SessionOrchestrator({
      browser,
      drivers: [new DeepSeekDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
      threadStore: store,
    });

    const tab = await orchestrator.resumeThread("t-resume-2");
    expect(tab.url).toBe("https://chat.deepseek.com/a/chat/s/t-resume-2");
    expect(browser.createdTabs).toContain("https://chat.deepseek.com/a/chat/s/t-resume-2");

    store.close();
  });
});
