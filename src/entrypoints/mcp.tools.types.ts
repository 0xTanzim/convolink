import type { ConvoErrorCode } from "../core/errors/convo-error.js";
import type { applySetup } from "./cli.setup.js";
import type { ElicitationPort } from "./mcp.elicitation.js";
import type { OnboardFacts } from "../core/services/onboarding.service.js";

export interface McpToolExecutionResult {
  readonly text: string;
  readonly isError?: boolean;
  /** Mirrors the declared outputSchema so clients need not parse prose. */
  readonly structured?: Record<string, unknown>;
  readonly writtenFiles?: readonly string[];
  readonly riskLabels?: readonly string[];
  readonly redactedSecretsCount?: number;
}

/** Setup verification launches a browser; this is the seam tests substitute. */
export type ApplySetupFn = typeof applySetup;

export interface ExecuteToolOptions {
  readonly workDir?: string;
  /** Test/logic seam: profile discovery touches the filesystem, so callers may inject it. */
  readonly discoverProfiles?: () => Promise<import("../adapters/browsers/browser-discovery.js").DiscoveredProfile[]>;
  /** Present only when the client advertised the MCP elicitation capability. */
  readonly elicitation?: ElicitationPort;
  /** Seam: setup verification starts a browser, so callers may substitute it. */
  readonly applySetupFn?: ApplySetupFn;
  /** Seam: onboarding reads daemon/extension/adapter state, so callers may substitute it. */
  readonly collectOnboardFacts?: () => Promise<OnboardFacts>;
  readonly onProgress?: { report(event: { stage: string; elapsedMs: number; platform?: string }): void };
}

export const NEXT_TOOL_HINTS: Partial<Record<ConvoErrorCode, { tool: string; args: Record<string, unknown> }>> = {
  "configuration-required": { tool: "convo_onboard", args: {} },
  "configuration-invalid": { tool: "convo_onboard", args: {} },
  "browser-unreachable": { tool: "convo_doctor", args: { fix: false } },
  "transport-disconnected": { tool: "convo_doctor", args: { fix: false } },
  "transport-mismatch": { tool: "convo_doctor", args: { fix: false } },
  "not-ready": { tool: "convo_doctor", args: { fix: false } },
  "session-busy": { tool: "convo_ask", args: {} },
  "thread-not-found": { tool: "convo_search", args: {} },
  "login-required": { tool: "convo_doctor", args: { fix: false } },
  "challenge-detected": { tool: "convo_doctor", args: { fix: false } },
};
