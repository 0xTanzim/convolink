import { describe, expect, it } from "bun:test";
import { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import { BrowserConnectionError } from "../../src/core/errors/bridge-errors.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { FakeThreadStore } from "../fakes/fake-storage.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { PolicyService } from "../../src/core/services/policy.service.js";
import { ArtifactService } from "../../src/core/services/artifact.service.js";
import { StateJournalService } from "../../src/core/services/journal.service.js";
import { TabManagerService } from "../../src/core/services/tab-manager.service.js";
import { ComparisonCoordinator } from "../../src/core/services/comparison-coordinator.service.js";
import type { WorkspaceSinkPort } from "../../src/core/ports/storage.port.js";
import type { BrowserPort, TransportHealth, TabDescriptor } from "../../src/core/ports/browser.port.js";

class OfflineBrowserPort extends FakeBrowserPort {
  public override async health(): Promise<TransportHealth> {
    return {
      ok: false,
      adapterId: "raw-cdp",
      endpoint: "http://127.0.0.1:9222",
      openTabsCount: 0,
      latencyMs: 1,
      error: "ECONNREFUSED",
    };
  }

  public override async listTabs(): Promise<TabDescriptor[]> {
    throw new BrowserConnectionError("127.0.0.1:9222", "ECONNREFUSED");
  }
}

describe("SessionOrchestrator Offline Resilience", () => {
  it("doctor() resolves gracefully when browser is offline instead of throwing", async () => {
    const browser = new OfflineBrowserPort();
    const lockService = new LockService();
    const journalService = new StateJournalService();
    const fakeSink: WorkspaceSinkPort = {
      persist: async () => ({ writtenFiles: [], skippedFiles: [] }),
    };
    const tabManager = new TabManagerService(browser, [], lockService, journalService);
    const comparisonCoordinator = new ComparisonCoordinator(undefined, tabManager, fakeSink);

    const orchestrator = new SessionOrchestrator({
      browser,
      drivers: [],
      lockService,
      policyGate: new PolicyService(),
      artifactService: new ArtifactService(),
      fileSink: fakeSink,
      journalService,
      threadStore: new FakeThreadStore(),
      tabManager,
      comparisonCoordinator,
    });

    const report = await orchestrator.doctor();
    expect(report.transportHealth.ok).toBe(false);
    expect(report.transportHealth.error).toBe("ECONNREFUSED");
    expect(report.totalTabs).toBe(0);
    expect(report.supportedTabs).toBe(0);
  });
});
