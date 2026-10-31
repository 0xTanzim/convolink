import type { ContextPacket } from "./compiler.port.js";
import type { ConversationTurn, PlatformId } from "./platform.port.js";

export interface ThreadRecord {
  readonly threadId: string;
  readonly platform: PlatformId;
  readonly title: string;
  readonly url: string;
  readonly lastSyncedTurnCount: number;
  readonly latestPacketHash?: string;
  readonly updatedAt: string;
}

export interface SearchResult {
  readonly threadId: string;
  readonly turnIndex: number;
  readonly role: "user" | "assistant";
  readonly snippet: string;
}

export interface ThreadStore {
  upsertThread(record: ThreadRecord): Promise<void>;
  appendTurns(threadId: string, turns: readonly ConversationTurn[]): Promise<void>;
  getTurns(threadId: string, lastNTurns?: number): Promise<ConversationTurn[]>;
  savePacket(packet: ContextPacket): Promise<void>;
  getLatestPacket(threadIdOrProjectId: string): Promise<ContextPacket | null>;
  listThreads(platform?: PlatformId): Promise<ThreadRecord[]>;
  searchTurns?(query: string, limit?: number): Promise<SearchResult[]>;
}

export interface CodeArtifact {
  readonly relativePath: string;
  readonly content: string;
  readonly language?: string;
  readonly isExplicitPath?: boolean;
}

export interface PersistOptions {
  readonly outDir: string;
  readonly overwrite?: boolean;
}

export interface WrittenFileRecord {
  readonly path: string;
  readonly relativePath: string;
  readonly bytes: number;
}

export interface SkippedFileRecord {
  readonly path: string;
  readonly relativePath: string;
  readonly reason: string;
}

export interface PersistResult {
  readonly writtenFiles: readonly WrittenFileRecord[];
  readonly skippedFiles: readonly SkippedFileRecord[];
}

export interface WorkspaceSinkPort {
  persist(artifacts: readonly CodeArtifact[], options: PersistOptions): Promise<PersistResult>;
}
