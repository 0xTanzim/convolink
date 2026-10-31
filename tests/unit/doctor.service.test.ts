import { describe, expect, it } from "bun:test";
import { runDoctorAudit } from "../../src/core/services/doctor.service.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import type { PlatformPort } from "../../src/core/ports/platform.port.js";
import type { DiscoveredTab } from "../../src/core/services/orchestrator.types.js";
import type { SessionHandle } from "../../src/core/ports/browser.port.js";

function createMockDriver(id: string, ok: boolean = true, layout: string = "standard"): PlatformPort {
  return {
    id,
    matchesUrl: (url: string) => url.includes(id),
    resolveSelectors: async (_handle: SessionHandle, _browser: unknown) => {
      if (!ok) throw new Error("Selectors unresolvable on page");
      return { ok: true, layoutVariant: layout };
    },
  } as unknown as PlatformPort;
}

describe("DoctorService (runDoctorAudit)", () => {
  it("audits open tabs and reports healthy status for supported platforms", async () => {
    const browser = new FakeBrowserPort();
    const lockService = new LockService();
    const driver = createMockDriver("deepseek", true, "two-pane");

    const tabs: DiscoveredTab[] = [
      { targetId: "tab-ds", title: "DeepSeek", url: "https://chat.deepseek.com", platformId: "deepseek", threadId: "123" },
      { targetId: "tab-ext", title: "External", url: "https://wikipedia.org", platformId: null, threadId: null },
    ];

    const report = await runDoctorAudit(
      browser,
      tabs,
      (url) => (url.includes("deepseek") ? driver : undefined),
      lockService,
    );

    expect(report.transportHealth.ok).toBe(true);
    expect(report.totalTabs).toBe(2);
    expect(report.supportedTabs).toBe(1);

    const dsDiagnosis = report.tabs.find((t) => t.targetId === "tab-ds");
    expect(dsDiagnosis).toBeDefined();
    expect(dsDiagnosis?.platformId).toBe("deepseek");
    expect(dsDiagnosis?.selectorsOk).toBe(true);
    expect(dsDiagnosis?.layoutVariant).toBe("two-pane");
    expect(dsDiagnosis?.isLocked).toBe(false);

    const extDiagnosis = report.tabs.find((t) => t.targetId === "tab-ext");
    expect(extDiagnosis).toBeDefined();
    expect(extDiagnosis?.platformId).toBeNull();
    expect(extDiagnosis?.selectorsOk).toBe(false);
  });

  it("detects locked tabs held by LockService", async () => {
    const browser = new FakeBrowserPort();
    const lockService = new LockService();
    const lockHandle = await lockService.acquireLock("tab-locked");

    const tabs: DiscoveredTab[] = [
      { targetId: "tab-locked", title: "Locked ChatGPT", url: "https://chatgpt.com", platformId: "chatgpt", threadId: null },
    ];

    try {
      const report = await runDoctorAudit(
        browser,
        tabs,
        () => createMockDriver("chatgpt"),
        lockService,
      );
      const diagnosis = report.tabs[0];
      expect(diagnosis?.isLocked).toBe(true);
    } finally {
      await lockService.releaseLock(lockHandle);
    }
  });

  it("captures selector resolution failure without throwing", async () => {
    const browser = new FakeBrowserPort();
    const lockService = new LockService();
    const failingDriver = createMockDriver("failing-ai", false);

    const tabs: DiscoveredTab[] = [
      { targetId: "tab-fail", title: "Broken Selectors", url: "https://failing-ai.com", platformId: "failing-ai" as any, threadId: null },
    ];

    const report = await runDoctorAudit(
      browser,
      tabs,
      () => failingDriver,
      lockService,
    );

    expect(report.tabs.length).toBe(1);
    const diag = report.tabs[0];
    expect(diag?.selectorsOk).toBe(false);
    expect(diag?.error).toContain("Selectors unresolvable on page");
  });
});
