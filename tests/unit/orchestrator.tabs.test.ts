import { describe, expect, it } from "bun:test";
import { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { PolicyService } from "../../src/core/services/policy.service.js";
import { StateJournalService } from "../../src/core/services/journal.service.js";

describe("SessionOrchestrator Tab & Rollback Operations", () => {
  function makeOrchestrator(browser = new FakeBrowserPort()) {
    const lockService = new LockService();
    const policyGate = new PolicyService();
    const journalService = new StateJournalService();
    const drivers = [new DeepSeekDriver()];

    const orchestrator = new SessionOrchestrator({
      browser,
      drivers,
      lockService,
      policyGate,
      journalService,
    });

    return { orchestrator, browser, journalService };
  }

  it("creates a new tab for a platform using platform.getBaseUrl()", async () => {
    const { orchestrator, browser } = makeOrchestrator();
    const tab = await orchestrator.createTab("deepseek");

    expect(tab.platformId).toBe("deepseek");
    expect(tab.url).toBe("https://chat.deepseek.com/");
    expect(browser.createdTabs).toContain("https://chat.deepseek.com/");
  });

  it("closes a tab cleanly via closeTab", async () => {
    const { orchestrator, browser } = makeOrchestrator();
    await orchestrator.closeTab("tab-1");
    expect(browser.closedTabs).toContain("tab-1");
  });

  it("resets active tab to new chat and journals checkpoint", async () => {
    const { orchestrator, browser, journalService } = makeOrchestrator();

    const tab = await orchestrator.startNewChat("tab-1");
    expect(tab.targetId).toBe("tab-1");
    expect(browser.evaluatedExpressions.some((e) => e.includes("startNewChat"))).toBe(true);

    const latest = journalService.getLatest("tab-1");
    expect(latest).not.toBeNull();
    expect(latest?.action).toBe("new_chat");
  });

  it("executes ask with newChat: true by resetting tab before prompt injection", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("resolveSelectors", {
      ok: true,
      layoutVariant: "v1",
      composerSelector: "textarea",
      sendButtonSelector: "button",
      stopIndicatorSelector: null,
      turnContainerSelector: ".ds-markdown",
    });
    browser.evalResponseMap.set("awaitCompletion", {
      mdCount: 1,
      hasNewTurn: true,
      isGenerating: false,
      turnIndex: 0,
      text: "New chat response",
      codeBlocks: [],
    });

    const { orchestrator } = makeOrchestrator(browser);
    const result = await orchestrator.ask({
      prompt: "Design fresh service",
      platform: "deepseek",
      newChat: true,
    });

    expect(result.turn.markdownContent).toBe("New chat response");
    expect(browser.evaluatedExpressions.some((e) => e.includes("startNewChat"))).toBe(true);
  });

  it("reverts mistake via undo by restoring previous checkpoint URL", async () => {
    const { orchestrator, browser, journalService } = makeOrchestrator();

    // Checkpoint 1 (original thread)
    journalService.record({
      targetId: "tab-1",
      platformId: "deepseek",
      url: "https://chat.deepseek.com/a/chat/s/important-thread-123",
      threadId: "important-thread-123",
      action: "ask",
    });

    // Checkpoint 2 (mistaken new chat)
    journalService.record({
      targetId: "tab-1",
      platformId: "deepseek",
      url: "https://chat.deepseek.com/",
      threadId: "default",
      action: "new_chat",
    });

    const restored = await orchestrator.undo("tab-1");
    expect(restored).not.toBeNull();
    expect(restored?.restoredUrl).toBe("https://chat.deepseek.com/a/chat/s/important-thread-123");
    expect(browser.navigatedUrls.some((n) => n.url.includes("important-thread-123"))).toBe(true);
  });

  it("navigates back via goBack", async () => {
    const { orchestrator, browser } = makeOrchestrator();
    await orchestrator.goBack("tab-1");
    expect(browser.backNavigations.length).toBe(1);
  });

  it("automatically auto-provisions a new tab when requested platform tab is not open", async () => {
    const browser = new FakeBrowserPort();
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
      text: "Auto provision reply",
      codeBlocks: [],
    });

    // Provide browser with NO deepseek tabs (only unrelated tab)
    browser.customTabs = [{ targetId: "other-tab", title: "Google", url: "https://www.google.com" }];

    const { orchestrator } = makeOrchestrator(browser);
    const result = await orchestrator.ask({
      prompt: "Hello DeepSeek",
      platform: "deepseek",
    });

    expect(result.turn.markdownContent).toBe("Auto provision reply");
    expect(browser.createdTabs).toContain("https://chat.deepseek.com/");
  });
});
