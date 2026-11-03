import { describe, expect, it } from "bun:test";
import { recordManagedTab } from "../../src/adapters/browsers/tab-registry.js";
import { TabManagerService } from "../../src/core/services/tab-manager.service.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";
import { ChatGPTDriver } from "../../src/adapters/platforms/chatgpt.driver.js";
import { LockService } from "../../src/core/services/lock.service.js";
import type { DiscoveredTab } from "../../src/core/services/orchestrator.types.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
process.env.XDG_RUNTIME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "convo-runtime-"));

describe("TabManagerService Anti-Ghost Lifecycle Invariants", () => {
  const drivers = [new DeepSeekDriver(), new ChatGPTDriver()];

  it("reuses a ConvoLink-owned tab without spawning another", async () => {
    let createTabCalled = false;
    const fakeBrowser = new FakeBrowserPort();
    fakeBrowser.createTab = async (_url: string) => {
      createTabCalled = true;
      return { targetId: "ghost-tab", url: _url, title: "Ghost Tab" };
    };

    const manager = new TabManagerService(fakeBrowser, drivers, new LockService());

    const existingTabs: DiscoveredTab[] = [
      {
        targetId: "existing-deepseek-tab",
        url: "https://chat.deepseek.com",
        title: "DeepSeek Chat",
        platformId: "deepseek",
        threadId: null,
      },
    ];

    recordManagedTab({ targetId: "existing-deepseek-tab", platform: "deepseek", url: "https://chat.deepseek.com", threadId: null, createdAt: "x" });
    const resolved = await manager.resolveOrAutoOpenTab(
      { platform: "deepseek", openTab: false },
      existingTabs,
    );

    expect(resolved.targetId).toBe("existing-deepseek-tab");
    expect(createTabCalled).toBe(false);
  });

  it("spawns new tab only when no matching platform tab exists", async () => {
    let createdUrl = "";
    const fakeBrowser = new FakeBrowserPort();
    fakeBrowser.createTab = async (url: string) => {
      createdUrl = url;
      return { targetId: "new-tab-123", url, title: "DeepSeek Tab" };
    };

    const manager = new TabManagerService(fakeBrowser, drivers, new LockService());

    const existingTabs: DiscoveredTab[] = [
      {
        targetId: "other-chatgpt-tab",
        url: "https://chatgpt.com",
        title: "ChatGPT",
        platformId: "chatgpt",
        threadId: null,
      },
    ];

    const resolved = await manager.resolveOrAutoOpenTab(
      { platform: "deepseek" },
      existingTabs,
    );

    expect(resolved.targetId).toBe("new-tab-123");
    expect(resolved.isNewlyCreated).toBe(true);
    expect(createdUrl).toBe("https://chat.deepseek.com/");
  });

  it("bypasses reuse when openTab is explicitly true", async () => {
    let createCount = 0;
    const fakeBrowser = new FakeBrowserPort();
    fakeBrowser.createTab = async (url: string) => {
      createCount++;
      return { targetId: `tab-${createCount}`, url, title: "New Tab" };
    };

    const manager = new TabManagerService(fakeBrowser, drivers, new LockService());

    const existingTabs: DiscoveredTab[] = [
      {
        targetId: "existing-tab",
        url: "https://chat.deepseek.com",
        title: "DeepSeek",
        platformId: "deepseek",
        threadId: null,
      },
    ];

    const resolved = await manager.resolveOrAutoOpenTab(
      { platform: "deepseek", openTab: true },
      existingTabs,
    );

    expect(createCount).toBe(1);
    expect(resolved.targetId).toBe("tab-1");
    expect(resolved.isNewlyCreated).toBe(true);
  });

  it("tracks newlyCreated status on DiscoveredTab accurately", async () => {
    const fakeBrowser = new FakeBrowserPort();
    fakeBrowser.createTab = async (url: string) => ({
      targetId: "tab-created",
      url,
      title: "Tab",
    });

    const manager = new TabManagerService(fakeBrowser, drivers, new LockService());
    const tab = await manager.createTab("deepseek");

    expect(tab.isNewlyCreated).toBe(true);
  });

  it("rolls back newly created tab if prompt submission throws error", async () => {
    let closedTargetId = "";
    const fakeBrowser = new FakeBrowserPort();
    fakeBrowser.createTab = async (url: string) => ({
      targetId: "new-fatal-tab",
      url,
      title: "Fatal Tab",
    });
    fakeBrowser.closeTab = async (targetId: string) => {
      closedTargetId = targetId;
    };

    const failingDriver = new DeepSeekDriver();
    failingDriver.submitPrompt = async () => {
      throw new Error("Simulated prompt network failure");
    };

    const { SessionOrchestrator } = await import("../../src/core/services/orchestrator.js");
    const { PolicyService } = await import("../../src/core/services/policy.service.js");

    const orchestrator = new SessionOrchestrator({
      browser: fakeBrowser,
      drivers: [failingDriver],
      lockService: new LockService(),
      policyGate: new PolicyService(),
      tabManager: new TabManagerService(fakeBrowser, [failingDriver], new LockService()),
    });

    await expect(
      orchestrator.ask({
        prompt: "Will fail",
        platform: "deepseek",
        openTab: true,
      }),
    ).rejects.toThrow("Simulated prompt network failure");

    expect(closedTargetId).toBe("new-fatal-tab");
  });
});
