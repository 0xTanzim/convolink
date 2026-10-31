import { Database } from "bun:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { ThreadStore, ThreadRecord, SearchResult } from "../../core/ports/storage.port.js";
import type { ConversationTurn, PlatformId } from "../../core/ports/platform.port.js";
import type { ContextPacket } from "../../core/ports/compiler.port.js";
import { HostEnv } from "../../core/env/host-env.js";
import { SqliteFtsHelper } from "./sqlite-fts.js";

export class SqliteLedgerAdapter implements ThreadStore {
  private readonly db: Database;

  constructor(customPath?: string) {
    const dbPath = customPath ?? path.join(HostEnv.getDataDir(), "ledger.sqlite");
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new Database(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY, platform TEXT NOT NULL, title TEXT NOT NULL,
        url TEXT NOT NULL, last_synced_turn_count INTEGER NOT NULL DEFAULT 0,
        latest_packet_hash TEXT, updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS turns (
        thread_id TEXT NOT NULL, turn_index INTEGER NOT NULL, role TEXT NOT NULL,
        markdown_content TEXT NOT NULL, code_blocks TEXT NOT NULL, content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL, PRIMARY KEY (thread_id, turn_index)
      );

      CREATE TABLE IF NOT EXISTS context_packets (
        packet_hash TEXT PRIMARY KEY, project_id TEXT NOT NULL, source_thread_id TEXT NOT NULL,
        platform TEXT NOT NULL, source_turn_start INTEGER NOT NULL, source_turn_end INTEGER NOT NULL,
        layout_variant TEXT NOT NULL, compiled_at TEXT NOT NULL, markdown_body TEXT NOT NULL, structured_json TEXT NOT NULL
      );
    `);
    SqliteFtsHelper.initSchema(this.db);
  }

  public async upsertThread(record: ThreadRecord): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO threads (thread_id, platform, title, url, last_synced_turn_count, latest_packet_hash, updated_at)
      VALUES ($threadId, $platform, $title, $url, $lastCount, $packetHash, $updatedAt)
      ON CONFLICT(thread_id) DO UPDATE SET
        platform = excluded.platform,
        title = excluded.title,
        url = excluded.url,
        last_synced_turn_count = excluded.last_synced_turn_count,
        latest_packet_hash = excluded.latest_packet_hash,
        updated_at = excluded.updated_at
    `);

    stmt.run({
      $threadId: record.threadId,
      $platform: record.platform,
      $title: record.title,
      $url: record.url,
      $lastCount: record.lastSyncedTurnCount,
      $packetHash: record.latestPacketHash ?? null,
      $updatedAt: record.updatedAt,
    });
  }

  public async appendTurns(threadId: string, turns: readonly ConversationTurn[]): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO turns (thread_id, turn_index, role, markdown_content, code_blocks, content_hash, created_at)
      VALUES ($threadId, $turnIndex, $role, $markdown, $codeBlocks, $contentHash, $createdAt)
      ON CONFLICT(thread_id, turn_index) DO UPDATE SET
        markdown_content = excluded.markdown_content,
        code_blocks = excluded.code_blocks,
        content_hash = excluded.content_hash
    `);

    const now = new Date().toISOString();
    this.db.transaction(() => {
      for (const turn of turns) {
        const codeBlocksJson = JSON.stringify(turn.codeBlocks ?? []);
        stmt.run({
          $threadId: threadId,
          $turnIndex: turn.turnIndex,
          $role: turn.role,
          $markdown: turn.markdownContent,
          $codeBlocks: codeBlocksJson,
          $contentHash: turn.contentHash,
          $createdAt: now,
        });
        SqliteFtsHelper.indexTurn(this.db, threadId, turn.turnIndex, turn.role, turn.markdownContent, codeBlocksJson);
      }
    })();
  }

  public async searchTurns(query: string, limit: number = 20): Promise<SearchResult[]> {
    return SqliteFtsHelper.search(this.db, query, limit);
  }

  public async getTurns(threadId: string, lastNTurns?: number): Promise<ConversationTurn[]> {
    const limitClause = lastNTurns && lastNTurns > 0 ? `LIMIT ${lastNTurns}` : "";
    const query = lastNTurns && lastNTurns > 0
      ? `SELECT * FROM (SELECT turn_index, role, markdown_content, code_blocks, content_hash FROM turns WHERE thread_id = $threadId ORDER BY turn_index DESC ${limitClause}) ORDER BY turn_index ASC`
      : `SELECT turn_index, role, markdown_content, code_blocks, content_hash FROM turns WHERE thread_id = $threadId ORDER BY turn_index ASC`;

    const rows = this.db.query(query).all({ $threadId: threadId }) as any[];
    return rows.map((r) => ({
      turnIndex: r.turn_index, role: r.role, markdownContent: r.markdown_content,
      codeBlocks: JSON.parse(r.code_blocks || "[]"), contentHash: r.content_hash,
    }));
  }

  public async savePacket(packet: ContextPacket): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO context_packets (
        packet_hash, project_id, source_thread_id, platform,
        source_turn_start, source_turn_end, layout_variant, compiled_at,
        markdown_body, structured_json
      ) VALUES ($hash, $projectId, $threadId, $platform, $start, $end, $layout, $compiledAt, $body, $structured)
      ON CONFLICT(packet_hash) DO UPDATE SET
        compiled_at = excluded.compiled_at,
        markdown_body = excluded.markdown_body,
        structured_json = excluded.structured_json
    `);

    stmt.run({
      $hash: packet.packetHash,
      $projectId: packet.projectId,
      $threadId: packet.sourceThreadId,
      $platform: packet.platform,
      $start: packet.sourceTurnRange[0],
      $end: packet.sourceTurnRange[1],
      $layout: packet.layoutVariant,
      $compiledAt: packet.compiledAt,
      $body: packet.markdownBody,
      $structured: JSON.stringify(packet.structured),
    });
  }

  public async getLatestPacket(threadIdOrProjectId: string): Promise<ContextPacket | null> {
    const row = this.db.query(`
      SELECT * FROM context_packets
      WHERE source_thread_id = $id OR project_id = $id
      ORDER BY compiled_at DESC
      LIMIT 1
    `).get({ $id: threadIdOrProjectId }) as any;

    if (!row) return null;
    return {
      projectId: row.project_id,
      packetHash: row.packet_hash,
      sourceThreadId: row.source_thread_id,
      platform: row.platform as PlatformId,
      sourceTurnRange: [row.source_turn_start, row.source_turn_end],
      layoutVariant: row.layout_variant,
      compiledAt: row.compiled_at,
      markdownBody: row.markdown_body,
      structured: JSON.parse(row.structured_json),
    };
  }

  public async listThreads(platform?: PlatformId): Promise<ThreadRecord[]> {
    const where = platform ? "WHERE platform = $platform" : "";
    const rows = this.db.query(`SELECT * FROM threads ${where} ORDER BY updated_at DESC`).all({
      $platform: platform ?? "",
    }) as any[];

    return rows.map((r) => ({
      threadId: r.thread_id,
      platform: r.platform as PlatformId,
      title: r.title,
      url: r.url,
      lastSyncedTurnCount: r.last_synced_turn_count,
      latestPacketHash: r.latest_packet_hash ?? undefined,
      updatedAt: r.updated_at,
    }));
  }

  public close(): void {
    this.db.close();
  }
}
