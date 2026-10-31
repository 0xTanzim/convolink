import type { ThreadRecord } from "../ports/storage.port.js";
import type { ConversationTurn } from "../ports/platform.port.js";

export class ThreadExportService {
  public static formatMarkdown(record: ThreadRecord, turns: readonly ConversationTurn[]): string {
    const lines: string[] = [
      `# Conversation Ledger: ${record.title}`,
      `- **Thread ID:** \`${record.threadId}\``,
      `- **Platform:** \`${record.platform}\``,
      `- **URL:** [${record.url}](${record.url})`,
      `- **Last Synced:** \`${record.updatedAt}\``,
      `- **Turn Count:** ${turns.length}`,
      "",
      "---",
      "",
    ];

    for (const turn of turns) {
      const roleLabel = turn.role === "user" ? "👤 User" : "🤖 Assistant";
      lines.push(`### ${roleLabel} (Turn ${turn.turnIndex})`, "", turn.markdownContent.trim(), "");
      if (turn.codeBlocks && turn.codeBlocks.length > 0) {
        lines.push(`*Contained ${turn.codeBlocks.length} code block(s)*`, "");
      }
      lines.push("---", "");
    }

    return lines.join("\n");
  }

  public static formatJson(record: ThreadRecord, turns: readonly ConversationTurn[]): string {
    return JSON.stringify({ thread: record, turns }, null, 2);
  }
}
