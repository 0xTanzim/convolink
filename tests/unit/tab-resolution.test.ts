import { describe, expect, it, beforeEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { TabManagerService } from "../../src/core/services/tab-manager.service.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { recordManagedTab, clearManagedTabs } from "../../src/adapters/browsers/tab-registry.js";
import type { DiscoveredTab } from "../../src/core/services/orchestrator.types.js";

const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "convo-tabs-"));
process.env.XDG_RUNTIME_DIR = runtime;

const THREAD = "64ce5050-7530-4840-a9e2-19f1deaa3507";

function tab(over: Partial<DiscoveredTab>): DiscoveredTab {
  return { targetId: "t", title: "t", url: "https://chat.deepseek.com/", platformId: "deepseek", threadId: null, ...over };
}

function manager(): TabManagerService {
  return new TabManagerService(new FakeBrowserPort(), [new DeepSeekDriver()], new LockService(), undefined, {
    readinessTimeoutMs: 0,
  });
}

describe("tab resolution and ownership", () => {
  beforeEach(() => clearManagedTabs());

  it("does not reuse a user's tab by default", async () => {
    const tm = manager();
    const browser = (tm as unknown as { browser: FakeBrowserPort }).browser;
    const userTab = tab({ targetId: "user-1" });

    const chosen = await tm.resolveOrAutoOpenTab({ platform: "deepseek" }, [userTab]);

    expect(chosen.targetId).not.toBe("user-1");
    expect(browser.createdTabs.length).toBe(1);
  });

  it("reuses a tab ConvoLink owns", async () => {
    recordManagedTab({ targetId: "managed-1", platform: "deepseek", url: "https://chat.deepseek.com/", threadId: null, createdAt: "x" });
    const tm = manager();

    const chosen = await tm.resolveOrAutoOpenTab({ platform: "deepseek" }, [tab({ targetId: "managed-1" })]);

    expect(chosen.targetId).toBe("managed-1");
  });

  it("reuses a tab already showing the named thread", async () => {
    const tm = manager();
    const userTab = tab({ targetId: "user-1", threadId: THREAD });

    const chosen = await tm.resolveOrAutoOpenTab(
      { platform: "deepseek", thread: { platform: "deepseek", threadId: THREAD, url: `https://chat.deepseek.com/a/chat/s/${THREAD}` } },
      [userTab],
    );

    expect(chosen.targetId).toBe("user-1");
  });

  it("opens the named thread in its own tab when none shows it", async () => {
    const tm = manager();
    const browser = (tm as unknown as { browser: FakeBrowserPort }).browser;
    const url = `https://chat.deepseek.com/a/chat/s/${THREAD}`;

    const chosen = await tm.resolveOrAutoOpenTab(
      { platform: "deepseek", thread: { platform: "deepseek", threadId: THREAD, url } },
      [tab({ targetId: "user-1" })],
    );

    expect(browser.createdTabs).toEqual([url]);
    expect(chosen.threadId).toBe(THREAD);
  });

  it("still honours an explicit target id", async () => {
    const tm = manager();
    const chosen = await tm.resolveOrAutoOpenTab({ targetId: "user-9", platform: "deepseek" }, [tab({ targetId: "user-9" })]);
    expect(chosen.targetId).toBe("user-9");
  });
});
