import type { Database } from "bun:sqlite";
import type { SearchResult } from "../../core/ports/storage.port.js";

export class SqliteFtsHelper {
  public static initSchema(db: Database): void {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
        thread_id,
        turn_index UNINDEXED,
        role UNINDEXED,
        markdown_content,
        code_blocks
      );
    `);
  }

  public static indexTurn(
    db: Database,
    threadId: string,
    turnIndex: number,
    role: string,
    markdown: string,
    codeBlocks: string,
  ): void {
    // Delete any prior FTS entry for this turn to prevent duplicate matches on re-sync
    db.prepare(`DELETE FROM turns_fts WHERE thread_id = $threadId AND turn_index = $turnIndex`).run({
      $threadId: threadId,
      $turnIndex: turnIndex,
    });

    db.prepare(`
      INSERT INTO turns_fts (thread_id, turn_index, role, markdown_content, code_blocks)
      VALUES ($threadId, $turnIndex, $role, $markdown, $codeBlocks)
    `).run({
      $threadId: threadId,
      $turnIndex: turnIndex,
      $role: role,
      $markdown: markdown,
      $codeBlocks: codeBlocks,
    });
  }

  public static search(db: Database, query: string, limit: number = 20): SearchResult[] {
    const sanitized = query.replace(/[^\w\s-]/g, " ").trim();
    if (!sanitized) return [];

    // Format query for prefix matching on each term
    const matchExpr = sanitized.split(/\s+/).map((t) => `"${t}"*`).join(" AND ");

    try {
      const rows = db.query(`
        SELECT thread_id, turn_index, role,
               snippet(turns_fts, 3, '<b>', '</b>', '...', 20) AS snippet
        FROM turns_fts
        WHERE turns_fts MATCH $matchExpr
        ORDER BY rank
        LIMIT $limit
      `).all({ $matchExpr: matchExpr, $limit: limit }) as any[];

      return rows.map((r) => ({
        threadId: r.thread_id,
        turnIndex: Number(r.turn_index),
        role: r.role,
        snippet: r.snippet,
      }));
    } catch {
      return [];
    }
  }
}
