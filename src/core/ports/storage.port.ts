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

export interface ThreadStore {
  upsertThread(record: ThreadRecord): Promise<void>;
  appendTurns(threadId: string, turns: readonly ConversationTurn[]): Promise<void>;
  getTurns(threadId: string, lastNTurns?: number): Promise<ConversationTurn[]>;
  savePacket(packet: ContextPacket): Promise<void>;
  getLatestPacket(threadIdOrProjectId: string): Promise<ContextPacket | null>;
  listThreads(platform?: PlatformId): Promise<ThreadRecord[]>;
}
