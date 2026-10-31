import type { TransportHealth } from "../ports/browser.port.js";
import type {
  CanvasDocument,
  ConversationTurn,
  PlatformId,
  PlatformPort,
  ToggleOptions,
} from "../ports/platform.port.js";
import type { BrowserPort } from "../ports/browser.port.js";
import type { PolicyGatePort, RiskLabel } from "../ports/policy.port.js";
import type { LockService } from "./lock.service.js";
import type { ArtifactService, ExtractedArtifact } from "./artifact.service.js";
import type { WorkspaceFileSink } from "./workspace-sink.service.js";

export interface DiscoveredTab {
  readonly targetId: string;
  readonly title: string;
  readonly url: string;
  readonly platformId: PlatformId | null;
  readonly threadId: string | null;
}

export interface DoctorTabDiagnosis {
  readonly targetId: string;
  readonly title: string;
  readonly url: string;
  readonly platformId: PlatformId | null;
  readonly selectorsOk: boolean;
  readonly layoutVariant: string | null;
  readonly isLocked: boolean;
  readonly error?: string;
}

export interface DoctorReport {
  readonly transportHealth: TransportHealth;
  readonly totalTabs: number;
  readonly supportedTabs: number;
  readonly tabs: DoctorTabDiagnosis[];
}

export interface AskOptions {
  readonly prompt: string;
  readonly platform?: PlatformId;
  readonly targetId?: string;
  readonly timeoutMs?: number;
  readonly toggles?: ToggleOptions;
  readonly files?: string[];
  readonly autoContinue?: boolean;
  readonly writeFiles?: boolean;
  readonly outDir?: string;
}

export interface AskResult {
  readonly tab: DiscoveredTab;
  readonly turn: ConversationTurn;
  readonly elapsedMs: number;
  readonly riskLabels: readonly RiskLabel[];
  readonly redactedSecretsCount: number;
  readonly artifacts?: readonly ExtractedArtifact[];
  readonly writtenFiles?: readonly string[];
  readonly canvasDocument?: CanvasDocument | null;
}

export interface OrchestratorDependencies {
  readonly browser: BrowserPort;
  readonly drivers: readonly PlatformPort[];
  readonly lockService: LockService;
  readonly policyGate: PolicyGatePort;
  readonly artifactService?: ArtifactService;
  readonly fileSink?: WorkspaceFileSink;
}
