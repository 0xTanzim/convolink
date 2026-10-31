import type { createContainer } from "../container.js";

type Orchestrator = ReturnType<typeof createContainer>["orchestrator"];

export async function handleDoctor(orchestrator: Orchestrator, args: string[]): Promise<number> {
  if (args.includes("--launch")) {
    console.log("🚀 Attempting to auto-launch Chrome with remote debugging on port 9222...");
    try {
      Bun.spawn(["bash", "scripts/fedora-chrome-debug.sh"], { stdout: "inherit", stderr: "inherit" });
    } catch {}
  }

  console.log("🔍 Running ConvoLink Doctor...\n");
  try {
    const report = await orchestrator.doctor();
    console.log(`[CDP Transport] Status: ${report.transportHealth.ok ? "ONLINE" : "OFFLINE"} (Latency: ${report.transportHealth.latencyMs}ms)`);
    console.log(`[Tabs] Found ${report.totalTabs} total open tab(s), ${report.supportedTabs} supported AI tab(s).\n`);

    for (const tab of report.tabs) {
      const platformBadge = tab.platformId ? `[${tab.platformId.toUpperCase()}]` : "[UNSUPPORTED]";
      const statusBadge = tab.selectorsOk ? "✅ READY" : (tab.platformId ? "⚠️ SELECTOR MISMATCH" : "⚪ IGNORED");
      const lockBadge = tab.isLocked ? "🔒 LOCKED" : "🔓 UNLOCKED";

      console.log(`• ${platformBadge} ${tab.title}`);
      console.log(`  Target: ${tab.targetId} | URL: ${tab.url}`);
      console.log(`  Status: ${statusBadge} | Mutex: ${lockBadge}`);
      if (tab.error) console.log(`  Error: ${tab.error}`);
      console.log("");
    }
    return report.transportHealth.ok ? 0 : 1;
  } catch (err: unknown) {
    console.error(`❌ Doctor check failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

export async function handleList(orchestrator: Orchestrator): Promise<number> {
  const tabs = await orchestrator.listTabs();
  console.log(`Found ${tabs.length} open tab(s):\n`);
  for (const t of tabs) {
    const p = t.platformId ? `[${t.platformId.toUpperCase()}]` : "[OTHER]";
    console.log(`${p} ${t.title}\n  Target: ${t.targetId}\n  URL: ${t.url}\n`);
  }
  return 0;
}

export async function handleTab(orchestrator: Orchestrator, args: string[]): Promise<number> {
  const sub = args[0] || "list";
  if (sub === "list") return handleList(orchestrator);
  if (sub === "new") {
    const target = args[1] || "chatgpt";
    const tab = await orchestrator.createTab(target);
    console.log(`✨ Created tab [${tab.targetId}] for ${tab.url}`);
    return 0;
  }
  if (sub === "close") {
    if (!args[1]) { console.error("Error: Target ID is required to close tab."); return 1; }
    await orchestrator.closeTab(args[1]);
    console.log(`🗑️ Closed tab [${args[1]}]`);
    return 0;
  }
  console.error(`Unknown tab subcommand: ${sub}`);
  return 1;
}

export async function handleUndo(orchestrator: Orchestrator, targetId?: string): Promise<number> {
  const restored = await orchestrator.undo(targetId);
  console.log(restored ? `↩️ Restored previous conversation: ${restored.restoredUrl}` : "No previous checkpoint found to restore.");
  return 0;
}

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

export async function handleSearch(orchestrator: Orchestrator, query: string): Promise<number> {
  if (!query || !query.trim()) {
    console.error("Error: Search query is required (e.g. convo search <query>)");
    return 1;
  }
  const results = await orchestrator.searchLedger(query);
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
