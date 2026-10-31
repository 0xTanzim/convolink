import { RawCdpAdapter } from "./adapters/browsers/raw-cdp.adapter.js";
import { AgentBrowserAdapter } from "./adapters/browsers/agent-browser.adapter.js";
import { DeepSeekDriver } from "./adapters/platforms/deepseek.driver.js";
import { ChatGPTDriver } from "./adapters/platforms/chatgpt.driver.js";
import { GeminiDriver } from "./adapters/platforms/gemini.driver.js";
import { LockService } from "./core/services/lock.service.js";
import { PolicyService } from "./core/services/policy.service.js";
import { ArtifactService } from "./core/services/artifact.service.js";
import { WorkspaceFileSink } from "./core/services/workspace-sink.service.js";
import { StateJournalService } from "./core/services/journal.service.js";
import { SessionOrchestrator } from "./core/services/orchestrator.js";
import type { BrowserPort } from "./core/ports/browser.port.js";
import type { PlatformPort } from "./core/ports/platform.port.js";

export interface AppContainer {
  readonly browser: BrowserPort;
  readonly drivers: readonly PlatformPort[];
  readonly lockService: LockService;
  readonly policyService: PolicyService;
  readonly artifactService: ArtifactService;
  readonly fileSink: WorkspaceFileSink;
  readonly journalService: StateJournalService;
  readonly orchestrator: SessionOrchestrator;
}

export interface ContainerOptions {
  readonly cdpEndpoint?: string;
  readonly browser?: BrowserPort;
  readonly transport?: "raw-cdp" | "agent-browser";
}

export function createContainer(options?: ContainerOptions): AppContainer {
  const endpoint = options?.cdpEndpoint ?? "http://127.0.0.1:9222";
  const portMatch = endpoint.match(/:(\d+)/);
  const port = portMatch && portMatch[1] ? parseInt(portMatch[1], 10) : 9222;

  const transport = options?.transport ?? (process.env.CONVOLINK_TRANSPORT === "agent-browser" ? "agent-browser" : "raw-cdp");
  const browser = options?.browser ?? (transport === "agent-browser" ? new AgentBrowserAdapter(port) : new RawCdpAdapter(endpoint));

  const drivers: readonly PlatformPort[] = [
    new DeepSeekDriver(),
    new ChatGPTDriver(),
    new GeminiDriver(),
  ];

  const lockService = new LockService();
  const policyService = new PolicyService();
  const artifactService = new ArtifactService();
  const fileSink = new WorkspaceFileSink();
  const journalService = new StateJournalService();

  const orchestrator = new SessionOrchestrator({
    browser,
    drivers,
    lockService,
    policyGate: policyService,
    artifactService,
    fileSink,
    journalService,
  });

  return {
    browser,
    drivers,
    lockService,
    policyService,
    artifactService,
    fileSink,
    journalService,
    orchestrator,
  };
}
