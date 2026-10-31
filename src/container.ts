import { RawCdpAdapter } from "./adapters/browsers/raw-cdp.adapter.js";
import { AgentBrowserAdapter } from "./adapters/browsers/agent-browser.adapter.js";
import { FirefoxBidiAdapter } from "./adapters/browsers/firefox-bidi.adapter.js";
import { DeepSeekDriver } from "./adapters/platforms/deepseek.driver.js";
import { ChatGPTDriver } from "./adapters/platforms/chatgpt.driver.js";
import { GeminiDriver } from "./adapters/platforms/gemini.driver.js";
import { ClaudeDriver } from "./adapters/platforms/claude.driver.js";
import { LockService } from "./core/services/lock.service.js";
import { PolicyService } from "./core/services/policy.service.js";
import { ArtifactService } from "./core/services/artifact.service.js";
import { WorkspaceFileSinkAdapter } from "./adapters/storage/workspace-sink.adapter.js";
import { StateJournalService } from "./core/services/journal.service.js";
import { TabManagerService } from "./core/services/tab-manager.service.js";
import { ComparisonCoordinator } from "./core/services/comparison-coordinator.service.js";
import { SqliteLedgerAdapter } from "./adapters/storage/sqlite-ledger.adapter.js";
import { SessionOrchestrator } from "./core/services/orchestrator.js";
import type { BrowserPort, BrowserAdapterId } from "./core/ports/browser.port.js";
import type { PlatformPort } from "./core/ports/platform.port.js";
import type { ThreadStore, WorkspaceSinkPort } from "./core/ports/storage.port.js";

export interface AppContainer {
  readonly browser: BrowserPort;
  readonly drivers: readonly PlatformPort[];
  readonly lockService: LockService;
  readonly policyService: PolicyService;
  readonly artifactService: ArtifactService;
  readonly fileSink: WorkspaceSinkPort;
  readonly journalService: StateJournalService;
  readonly threadStore: ThreadStore;
  readonly tabManager: TabManagerService;
  readonly comparisonCoordinator: ComparisonCoordinator;
  readonly orchestrator: SessionOrchestrator;
}

export interface ContainerOptions {
  readonly cdpEndpoint?: string;
  readonly browser?: BrowserPort;
  readonly transport?: BrowserAdapterId;
  readonly threadStore?: ThreadStore;
}

export function createContainer(options?: ContainerOptions): AppContainer {
  const endpoint = options?.cdpEndpoint ?? "http://127.0.0.1:9222";
  const portMatch = endpoint.match(/:(\d+)/);
  const port = portMatch && portMatch[1] ? parseInt(portMatch[1], 10) : 9222;

  const transport = options?.transport ?? (process.env.CONVOLINK_TRANSPORT as BrowserAdapterId | undefined ?? "raw-cdp");
  const browser = options?.browser ?? (
    transport === "agent-browser"
      ? new AgentBrowserAdapter(port)
      : transport === "firefox-bidi"
        ? new FirefoxBidiAdapter(port)
        : new RawCdpAdapter(endpoint)
  );

  const drivers: readonly PlatformPort[] = [
    new DeepSeekDriver(),
    new ChatGPTDriver(),
    new GeminiDriver(),
    new ClaudeDriver(),
  ];

  const lockService = new LockService();
  const policyService = new PolicyService();
  const artifactService = new ArtifactService();
  const fileSink: WorkspaceSinkPort = new WorkspaceFileSinkAdapter();
  const journalService = new StateJournalService();
  const threadStore = options?.threadStore ?? new SqliteLedgerAdapter();

  const tabManager = new TabManagerService(browser, drivers, lockService, journalService);
  const comparisonCoordinator = new ComparisonCoordinator(undefined, tabManager, fileSink);

  const orchestrator = new SessionOrchestrator({
    browser,
    drivers,
    lockService,
    policyGate: policyService,
    artifactService,
    fileSink,
    journalService,
    threadStore,
    tabManager,
    comparisonCoordinator,
  });

  return {
    browser,
    drivers,
    lockService,
    policyService,
    artifactService,
    fileSink,
    journalService,
    threadStore,
    tabManager,
    comparisonCoordinator,
    orchestrator,
  };
}
