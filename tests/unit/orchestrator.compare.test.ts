import { describe, expect, it } from "bun:test";
import { recordManagedTab } from "../../src/adapters/browsers/tab-registry.js";
import { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";
import { ChatGPTDriver } from "../../src/adapters/platforms/chatgpt.driver.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { PolicyService } from "../../src/core/services/policy.service.js";
import { StateJournalService } from "../../src/core/services/journal.service.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
process.env.XDG_RUNTIME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "convo-runtime-"));

describe("SessionOrchestrator.compare()", () => {
  it("orchestrates comparison across multiple platforms and generates report", async () => {
    const browser = new FakeBrowserPort();

    // Mock open tabs for deepseek and chatgpt
    browser.listTabs = async () => [
      { targetId: "tab-ds", title: "DeepSeek", url: "https://chat.deepseek.com/a/chat/s/1" },
      { targetId: "tab-gpt", title: "ChatGPT", url: "https://chatgpt.com/c/2" },
    ];
    recordManagedTab({ targetId: "tab-ds", platform: "deepseek", url: "https://chat.deepseek.com/a/chat/s/1", threadId: "1", createdAt: "x" });
    recordManagedTab({ targetId: "tab-gpt", platform: "chatgpt", url: "https://chatgpt.com/c/2", threadId: "2", createdAt: "x" });

    browser.evalResponseMap.set("resolveSelectors", {
      ok: true,
      layoutVariant: "v1",
      composerSelector: "textarea",
      sendButtonSelector: "button",
      stopIndicatorSelector: null,
      turnContainerSelector: ".turn",
    });

    browser.evalResponseMap.set("awaitCompletion", {
      mdCount: 1,
      hasNewTurn: true,
      isGenerating: false,
      turnIndex: 0,
      text: "Comparison solution text",
      codeBlocks: [{ language: "typescript", code: "export const x = 1;" }],
    });

    const orchestrator = new SessionOrchestrator({
      browser,
      drivers: [new DeepSeekDriver(), new ChatGPTDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
      journalService: new StateJournalService(),
    });

    const report = await orchestrator.compare({
      prompt: "Design Redis cache layer",
      platforms: ["deepseek", "chatgpt"],
      mode: "parallel", continueThreads: true });

    expect(report.comparisonId).toBeDefined();
    expect(report.prompt).toBe("Design Redis cache layer");
    expect(report.results.length).toBe(2);
    expect(report.metrics.length).toBe(2);
    expect(report.markdownReport).toContain("# Multi-Model Comparison: Design Redis cache layer");
  });

  it("orchestrates comparison with stage 2 arbitration", async () => {
    const browser = new FakeBrowserPort();

    browser.listTabs = async () => [
      { targetId: "tab-ds", title: "DeepSeek", url: "https://chat.deepseek.com/a/chat/s/1" },
      { targetId: "tab-gpt", title: "ChatGPT", url: "https://chatgpt.com/c/2" },
    ];
    recordManagedTab({ targetId: "tab-ds", platform: "deepseek", url: "https://chat.deepseek.com/a/chat/s/1", threadId: "1", createdAt: "x" });
    recordManagedTab({ targetId: "tab-gpt", platform: "chatgpt", url: "https://chatgpt.com/c/2", threadId: "2", createdAt: "x" });

    browser.evalResponseMap.set("resolveSelectors", {
      ok: true,
      layoutVariant: "v1",
      composerSelector: "textarea",
      sendButtonSelector: "button",
      stopIndicatorSelector: null,
      turnContainerSelector: ".turn",
    });

    browser.evalResponseMap.set("awaitCompletion", {
      mdCount: 1,
      hasNewTurn: true,
      isGenerating: false,
      turnIndex: 0,
      text: "Candidate solution",
      codeBlocks: [{ language: "typescript", code: "const a = 1;" }],
    });

    const orchestrator = new SessionOrchestrator({
      browser,
      drivers: [new DeepSeekDriver(), new ChatGPTDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
      journalService: new StateJournalService(),
    });

    const report = await orchestrator.compare({
      prompt: "Build an event bus",
      platforms: ["deepseek", "chatgpt"],
      arbitrate: true,
      arbiter: "deepseek", continueThreads: true });

    expect(report.arbitration).toBeDefined();
    expect(report.arbitration?.arbiterPlatform).toBe("deepseek");
    expect(report.markdownReport).toContain("Technical Arbiter Synthesis (DeepSeek)");
  });
});
