import { describe, expect, it } from "bun:test";
import { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";
import { ChatGPTDriver } from "../../src/adapters/platforms/chatgpt.driver.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { PolicyService } from "../../src/core/services/policy.service.js";
import { TabNotFoundError } from "../../src/core/errors/bridge-errors.js";

describe("SessionOrchestrator", () => {
  it("lists discovered tabs and matches platform drivers", async () => {
    const browser = new FakeBrowserPort();
    browser.listTabs = async () => [
      { targetId: "tab-ds", title: "DeepSeek Chat", url: "https://chat.deepseek.com/a/chat/s/uuid-1" },
      { targetId: "tab-gpt", title: "ChatGPT", url: "https://chatgpt.com/c/gpt-2" },
      { targetId: "tab-gh", title: "GitHub", url: "https://github.com/trending" },
    ];

    const orchestrator = new SessionOrchestrator({
      browser,
      drivers: [new DeepSeekDriver(), new ChatGPTDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
    });

    const tabs = await orchestrator.listTabs();

    expect(tabs.length).toBe(3);
    expect(tabs[0]?.platformId).toBe("deepseek");
    expect(tabs[0]?.threadId).toBe("uuid-1");
    expect(tabs[1]?.platformId).toBe("chatgpt");
    expect(tabs[1]?.threadId).toBe("gpt-2");
    expect(tabs[2]?.platformId).toBeNull();
  });

  it("runs doctor diagnostic check across active platform tabs", async () => {
    const browser = new FakeBrowserPort();
    browser.listTabs = async () => [
      { targetId: "tab-ds", title: "DeepSeek Chat", url: "https://chat.deepseek.com/a/chat/s/uuid-1" },
    ];
    browser.evalResponseMap.set("resolveSelectors", {
      ok: true,
      layoutVariant: "deepseek-v3",
      composerSelector: "textarea",
      sendButtonSelector: "button",
      stopIndicatorSelector: null,
      turnContainerSelector: ".ds-turn",
    });

    const orchestrator = new SessionOrchestrator({
      browser,
      drivers: [new DeepSeekDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
    });

    const report = await orchestrator.doctor();

    expect(report.totalTabs).toBe(1);
    expect(report.supportedTabs).toBe(1);
    expect(report.tabs[0]?.selectorsOk).toBe(true);
    expect(report.tabs[0]?.layoutVariant).toBe("deepseek-v3");
  });

  it("executes ask workflow with secret scrubbing, mutex locking, and clean detach", async () => {
    const browser = new FakeBrowserPort();
    browser.listTabs = async () => [
      { targetId: "tab-ds", title: "DeepSeek Chat", url: "https://chat.deepseek.com/a/chat/s/uuid-1" },
    ];
    browser.evalResponseMap.set("submitPrompt", {
      turnCount: 0,
      lastTurnHash: "0",
      submittedPromptHash: "10",
    });
    browser.evalResponseMap.set("awaitCompletion", {
      turnIndex: 1,
      hasNewTurn: true,
      isGenerating: false,
      text: "Here is your script:\n```bash\nrm -rf /tmp/test\n```",
      codeBlocks: [{ language: "bash", code: "rm -rf /tmp/test" }],
    });

    const lockService = new LockService();
    const policyGate = new PolicyService();

    const orchestrator = new SessionOrchestrator({
      browser,
      drivers: [new DeepSeekDriver()],
      lockService,
      policyGate,
    });

    const rawPrompt = "Here is sk-proj-123456789012345678901234567890 please write clean script";
    const result = await orchestrator.ask({
      prompt: rawPrompt,
      platform: "deepseek",
    });

    expect(result.tab.targetId).toBe("tab-ds");
    expect(result.turn.role).toBe("assistant");
    expect(result.redactedSecretsCount).toBe(1);
    expect(result.riskLabels).toContain("contains_destructive_command");
    expect(result.riskLabels).toContain("contains_shell_execution");

    // Lock must be released after completion
    expect(lockService.isLocked("tab-ds")).toBe(false);
  });

  it("throws TabNotFoundError when requested platform tab is not open", async () => {
    const browser = new FakeBrowserPort();
    browser.listTabs = async () => [];

    const orchestrator = new SessionOrchestrator({
      browser,
      drivers: [new DeepSeekDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
    });

    expect(orchestrator.ask({ prompt: "hello", platform: "chatgpt" })).rejects.toThrow(
      TabNotFoundError,
    );
  });
});
