import type { PlatformId, ConversationTurn } from "../ports/platform.port.js";
import type { DiscoveredTab } from "./orchestrator.types.js";
import type { ExtractedArtifact } from "./artifact.service.js";

export type ExecutionScheduleMode = "parallel" | "sequential";

export interface ModelExecutionResult {
  readonly platform: PlatformId;
  readonly tab: DiscoveredTab;
  readonly status: "success" | "failed" | "timeout";
  readonly elapsedMs: number;
  readonly turn?: ConversationTurn;
  readonly artifacts?: readonly ExtractedArtifact[];
  readonly error?: string;
}

export interface PlatformMetric {
  readonly platform: PlatformId;
  readonly status: "success" | "failed" | "timeout";
  readonly elapsedMs: number;
  readonly codeBlockCount: number;
  readonly totalLinesOfCode: number;
  readonly characterCount: number;
}

export interface ComparisonReport {
  readonly comparisonId: string;
  readonly prompt: string;
  readonly scheduleMode: ExecutionScheduleMode;
  readonly timestamp: string;
  readonly totalDurationMs: number;
  readonly results: readonly ModelExecutionResult[];
  readonly metrics: readonly PlatformMetric[];
  readonly fastestPlatform?: PlatformId;
  readonly markdownReport: string;
}

export interface CompareOptions {
  readonly prompt: string;
  readonly platforms?: PlatformId[];
  readonly timeoutMs?: number;
  readonly mode?: ExecutionScheduleMode;
  readonly outDir?: string;
  readonly autoSpawn?: boolean;
}
