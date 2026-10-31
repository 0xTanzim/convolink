import type { createContainer } from "../container.js";
export { handleHistory, handleResume, handleExport, handleSearch } from "./cli.storage.js";

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
