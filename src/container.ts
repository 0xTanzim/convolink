import * as fs from "node:fs";
import * as path from "node:path";
import { RawCdpAdapter } from "./adapters/browsers/raw-cdp.adapter.js";
import { AgentBrowserAdapter } from "./adapters/browsers/agent-browser.adapter.js";
import { FirefoxBidiAdapter } from "./adapters/browsers/firefox-bidi.adapter.js";
import { ExtensionBridgeAdapter } from "./adapters/browsers/extension-bridge.adapter.js";
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
import { fileTabRegistry } from "./adapters/browsers/tab-registry.js";
import { defaultTabReadiness } from "./adapters/platforms/tab-readiness.adapter.js";
import { SessionOrchestrator } from "./core/services/orchestrator.js";
import { BridgeTokenService } from "./core/services/bridge-token.service.js";
import { normalizeBrowserName } from "./core/env/browser-name.js";
import type { BrowserPort, BrowserAdapterId } from "./core/ports/browser.port.js";
import type { ResolvedSetup } from "./core/services/setup/precedence.js";
import { createBrowserAdapter } from "./adapters/browsers/browser-factory.js";
import type { PlatformPort } from "./core/ports/platform.port.js";
import type { ThreadStore, WorkspaceSinkPort } from "./core/ports/storage.port.js";

export interface AppContainer {
  /** Releases remote browser sessions (Firefox allows only one). */
  readonly shutdown: () => Promise<void>;
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
  /** Resolved once by the caller; the container never reads configuration. */
  readonly resolution?: ResolvedSetup;
  readonly cdpEndpoint?: string;
  readonly browser?: BrowserPort;
  readonly transport?: BrowserAdapterId;
  readonly browserName?: string;
  readonly threadStore?: ThreadStore;
  readonly workDir?: string;
}

export function createContainer(options?: ContainerOptions): AppContainer {
  const resolved = options?.resolution;
  let transport: BrowserAdapterId | undefined =
    resolved?.transport ?? options?.transport ?? (process.env.CONVOLINK_TRANSPORT as BrowserAdapterId | undefined);
  if (!transport && options?.browserName) {
    const norm = normalizeBrowserName(options.browserName);
    if (norm.id !== "auto") transport = norm.transport;
  }
  if (!transport) transport = "raw-cdp";

  const defaultPort = transport === "firefox-bidi" ? 9223 : (transport === "extension-bridge" ? 9224 : 9222);
  const port = resolved?.port ?? (options?.cdpEndpoint ? Number(options.cdpEndpoint.match(/:(\d+)/)?.[1] ?? defaultPort) : defaultPort);
  // A dedicated profile can bind a different interface than 127.0.0.1 (for
  // example [::1] when the default profile already owns IPv4 on that port).
  const envHost = process.env.CONVOLINK_HOST;
  const endpoint = envHost
    ? `http://${envHost}:${port}`
    : (resolved?.endpoint ?? options?.cdpEndpoint ?? `http://127.0.0.1:${port}`);

  const browser = options?.browser ?? createBrowserAdapter({ transport, endpoint, port });

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

  const tabManager = new TabManagerService(browser, drivers, lockService, journalService, {
    tabRegistry: fileTabRegistry,
    tabReadiness: defaultTabReadiness,
  });
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

  const shutdown = async (): Promise<void> => {
    // Firefox keeps a single BiDi session; releasing it explicitly is what makes
    // the next command work without restarting the browser.
    const port = browser as BrowserPort & { disconnect?: () => Promise<void> };
    await port.disconnect?.().catch(() => {});
  };

  return {
    shutdown,
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
