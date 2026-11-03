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
import type { ProgressPort } from "../ports/progress.port.js";
import type { ThreadTarget } from "./setup/thread-target.js";
import type { LockService } from "./lock.service.js";
import type { ArtifactService, ExtractedArtifact } from "./artifact.service.js";
import type { WorkspaceSinkPort, ThreadStore } from "../ports/storage.port.js";
import type { StateJournalService } from "./journal.service.js";
import type { TabManagerService } from "./tab-manager.service.js";
import type { ComparisonCoordinator } from "./comparison-coordinator.service.js";

export interface DiscoveredTab {
  readonly targetId: string;
  readonly title: string;
  readonly url: string;
  readonly platformId: PlatformId | null;
  readonly threadId: string | null;
  readonly isNewlyCreated?: boolean;
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
  readonly newChat?: boolean;
  readonly openTab?: boolean;
  readonly progress?: ProgressPort;
  /** Fired once the prompt has left the composer, before generation is awaited. */
  readonly onSubmitted?: () => void;
  /** Explicit conversation URL; the user naming it is the consent to drive it. */
  readonly thread?: ThreadTarget;
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
  readonly fileSink?: WorkspaceSinkPort;
  readonly journalService?: StateJournalService;
  readonly threadStore?: ThreadStore;
  readonly tabManager?: TabManagerService;
  readonly comparisonCoordinator?: ComparisonCoordinator;
}
