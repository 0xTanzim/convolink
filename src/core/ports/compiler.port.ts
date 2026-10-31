import type { ConversationTurn, PlatformId } from "./platform.port.js";

export interface ContextPacket {
  readonly projectId: string;
  readonly packetHash: string; // SHA-256 of deterministic markdown body
  readonly sourceThreadId: string;
  readonly platform: PlatformId;
  readonly sourceTurnRange: readonly [number, number];
  readonly layoutVariant: string;
  readonly compiledAt: string;
  readonly markdownBody: string;
  readonly structured: {
    readonly activeInvariants: readonly string[];
    readonly settledDecisions: readonly string[];
    readonly discardedApproaches: readonly string[];
    readonly canonicalInterfaces: ReadonlyArray<{ readonly language: string; readonly code: string }>;
    readonly immediateDirective: string;
  };
}

export interface ContextCompilerPort {
  compile(params: {
    projectId: string;
    threadId: string;
    platform: PlatformId;
    layoutVariant: string;
    turns: readonly ConversationTurn[];
  }): ContextPacket;
}
