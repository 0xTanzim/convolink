import type { ThreadStore, ThreadRecord, SearchResult } from "../../src/core/ports/storage.port.js";
import type { ConversationTurn, PlatformId } from "../../src/core/ports/platform.port.js";
import type { ContextPacket } from "../../src/core/ports/compiler.port.js";

/**
 * Pure in-memory ThreadStore double for hermetic unit testing.
 * Implements ThreadStore interface with zero filesystem or SQLite dependencies.
 */
export class FakeThreadStore implements ThreadStore {
  public readonly threads = new Map<string, ThreadRecord>();
  public readonly turns = new Map<string, ConversationTurn[]>();
  public readonly packets = new Map<string, ContextPacket>();

  public async upsertThread(record: ThreadRecord): Promise<void> {
    this.threads.set(record.threadId, { ...record });
  }

  public async getThread(threadId: string): Promise<ThreadRecord | null> {
    return this.threads.get(threadId) ?? null;
  }

  public async appendTurns(threadId: string, turns: readonly ConversationTurn[]): Promise<void> {
    const existing = this.turns.get(threadId) ?? [];
    const turnMap = new Map<number, ConversationTurn>();
    for (const t of existing) {
      turnMap.set(t.turnIndex, t);
    }
    for (const t of turns) {
      turnMap.set(t.turnIndex, { ...t });
    }
    const merged = Array.from(turnMap.values()).sort((a, b) => a.turnIndex - b.turnIndex);
    this.turns.set(threadId, merged);
  }

  public async getTurns(threadId: string, lastNTurns?: number): Promise<ConversationTurn[]> {
    const threadTurns = this.turns.get(threadId) ?? [];
    if (lastNTurns !== undefined && lastNTurns > 0) {
      return threadTurns.slice(-lastNTurns);
    }
    return [...threadTurns];
  }

  public async savePacket(packet: ContextPacket): Promise<void> {
    this.packets.set(packet.packetHash, { ...packet });
  }

  public async getLatestPacket(threadIdOrProjectId: string): Promise<ContextPacket | null> {
    const matches = Array.from(this.packets.values()).filter(
      (p) => p.sourceThreadId === threadIdOrProjectId || p.projectId === threadIdOrProjectId,
    );
    if (matches.length === 0) return null;
    matches.sort((a, b) => new Date(b.compiledAt).getTime() - new Date(a.compiledAt).getTime());
    return matches[0] ?? null;
  }

  public async listThreads(platform?: PlatformId): Promise<ThreadRecord[]> {
    let list = Array.from(this.threads.values());
    if (platform) {
      list = list.filter((t) => t.platform === platform);
    }
    return list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  public async searchTurns(query: string, limit: number = 20): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const lowerQuery = query.toLowerCase();

    for (const [threadId, turnList] of this.turns.entries()) {
      for (const turn of turnList) {
        const contentLower = turn.markdownContent.toLowerCase();
        const idx = contentLower.indexOf(lowerQuery);
        if (idx !== -1) {
          const start = Math.max(0, idx - 30);
          const end = Math.min(turn.markdownContent.length, idx + query.length + 30);
          const snippet = turn.markdownContent.slice(start, end).trim();
          results.push({
            threadId,
            turnIndex: turn.turnIndex,
            role: turn.role,
            snippet,
          });
          if (results.length >= limit) return results;
        }
      }
    }
    return results;
  }

  public async search(query: string, limit?: number): Promise<SearchResult[]> {
    return this.searchTurns(query, limit);
  }

  public clear(): void {
    this.threads.clear();
    this.turns.clear();
    this.packets.clear();
  }
}
