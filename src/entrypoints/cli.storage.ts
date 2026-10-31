import type { createContainer } from "../container.js";

type Orchestrator = ReturnType<typeof createContainer>["orchestrator"];

export function handleHistory(container: ReturnType<typeof createContainer>, targetId?: string): number {
  const history = container.journalService.list(targetId);
  console.log(`Recent Checkpoints (${history.length}):`);
  for (const c of history) console.log(`[${c.id}] [${c.action}] [${c.targetId}] ${c.url} (${c.timestamp})`);
  return 0;
}

export async function handleResume(orchestrator: Orchestrator, threadId?: string): Promise<number> {
  if (!threadId) {
    console.error("Error: threadId is required (e.g. convo resume <threadId>)");
    return 1;
  }
  try {
    const tab = await orchestrator.resumeThread(threadId);
    console.log(`🔄 Resumed thread [${threadId}] in tab: ${tab.targetId} (${tab.url})`);
    return 0;
  } catch (err: unknown) {
    console.error(`❌ Resume failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

export async function handleExport(orchestrator: Orchestrator, args: string[]): Promise<number> {
  const threadId = args[0];
  if (!threadId) {
    console.error("Error: threadId is required (e.g. convo export <threadId> [--format json|markdown])");
    return 1;
  }
  const format = args.includes("--format") && args[args.indexOf("--format") + 1] === "json" ? "json" : "markdown";
  try {
    const output = await orchestrator.exportThread(threadId, format);
    console.log(output);
    return 0;
  } catch (err: unknown) {
    console.error(`❌ Export failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

export async function handleSearch(orchestrator: Orchestrator, rawQuery: string): Promise<number> {
  let query = rawQuery?.trim() ?? "";
  let limit = 10;
  const limitMatch = query.match(/(?:^|\s)--limit\s+(\d+)(?:\s|$)/);
  if (limitMatch && limitMatch[1]) {
    limit = Number.parseInt(limitMatch[1], 10);
    query = query.replace(/(?:^|\s)--limit\s+\d+(?:\s|$)/, " ").trim();
  }

  if (!query) {
    console.error("Error: Search query is required (e.g. convo search <query>)");
    return 1;
  }
  const results = await orchestrator.searchLedger(query, limit);
  if (results.length === 0) {
    console.log(`No turns found matching "${query}".`);
    return 0;
  }
  console.log(`🔍 Found ${results.length} turn match(es) for "${query}":\n`);
  for (const r of results) {
    console.log(`• [Thread: ${r.threadId}] Turn ${r.turnIndex} (${r.role}):`);
    console.log(`  ${r.snippet}\n`);
  }
  return 0;
}
