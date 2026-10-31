import { createContainer } from "../container.js";
import { parseAskArgs, parseCompareArgs, printHelp, readStdin } from "./cli.args.js";
import type { BrowserAdapterId } from "../core/ports/browser.port.js";

export async function runCli(args: string[]): Promise<number> {
  const command = args[0] || "doctor";
  const transportFlagIdx = args.indexOf("--transport");
  const transport = transportFlagIdx !== -1 ? (args[transportFlagIdx + 1] as BrowserAdapterId) : undefined;
  const container = createContainer({ transport });

  switch (command) {
    case "doctor":
      return handleDoctor(container.orchestrator, args.slice(1));
    case "list":
      return handleList(container.orchestrator);
    case "ask":
      return handleAsk(container.orchestrator, args.slice(1), transport);
    case "compare":
      return handleCompare(container.orchestrator, args.slice(1));
    case "tab":
      return handleTab(container.orchestrator, args.slice(1));
    case "back":
      await container.orchestrator.goBack(args[1]);
      console.log(`⬅️ Navigated back in browser history.`);
      return 0;
    case "undo":
      return handleUndo(container.orchestrator, args[1]);
    case "history":
      return handleHistory(container, args[1]);
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return 0;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      return 1;
  }
}

async function handleDoctor(orchestrator: ReturnType<typeof createContainer>["orchestrator"], args: string[]): Promise<number> {
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
      console.log(`  TargetId: ${tab.targetId} | ${statusBadge} | ${lockBadge}`);
      console.log(`  URL: ${tab.url}`);
      if (tab.layoutVariant) console.log(`  Layout: ${tab.layoutVariant}`);
      if (tab.error) console.log(`  Error: ${tab.error}`);
      console.log("");
    }

    return report.supportedTabs > 0 ? 0 : 1;
  } catch (err: unknown) {
    console.error(`❌ Doctor diagnostic failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

async function handleList(orchestrator: ReturnType<typeof createContainer>["orchestrator"]): Promise<number> {
  const tabs = await orchestrator.listTabs();
  console.log(`Open Tabs (${tabs.length}):`);
  for (const t of tabs) {
    const platform = t.platformId ?? "unsupported";
    console.log(`[${t.targetId}] [${platform}] ${t.title} (${t.url})`);
  }
  return 0;
}

async function handleTab(orchestrator: ReturnType<typeof createContainer>["orchestrator"], args: string[]): Promise<number> {
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

async function handleUndo(orchestrator: ReturnType<typeof createContainer>["orchestrator"], targetId?: string): Promise<number> {
  const restored = await orchestrator.undo(targetId);
  console.log(restored ? `↩️ Restored previous conversation: ${restored.restoredUrl}` : "No previous checkpoint found to restore.");
  return 0;
}

function handleHistory(container: ReturnType<typeof createContainer>, targetId?: string): number {
  const history = container.journalService.list(targetId);
  console.log(`Recent Checkpoints (${history.length}):`);
  for (const c of history) console.log(`[${c.id}] [${c.action}] [${c.targetId}] ${c.url} (${c.timestamp})`);
  return 0;
}

async function handleAsk(
  orchestrator: ReturnType<typeof createContainer>["orchestrator"],
  args: string[],
  transport?: BrowserAdapterId,
): Promise<number> {
  const parsed = parseAskArgs(args);
  let prompt = parsed.prompt || (await readStdin());

  if (!prompt.trim()) {
    console.error("Error: Prompt is required. Provide as arguments or pipe via stdin.");
    return 1;
  }

  try {
    const result = await orchestrator.ask({
      prompt,
      platform: parsed.platform,
      targetId: parsed.targetId,
      timeoutMs: parsed.timeoutMs,
      toggles: Object.keys(parsed.toggles).length > 0 ? parsed.toggles : undefined,
      writeFiles: parsed.writeFiles,
      outDir: parsed.outDir,
      autoContinue: parsed.autoContinue,
      newChat: parsed.newChat,
      openTab: parsed.openTab,
    });

    if (result.redactedSecretsCount > 0) {
      console.error(`🛡️ [PolicyGate] Redacted ${result.redactedSecretsCount} secret(s) from outbound prompt.`);
    }

    if (result.riskLabels.includes("contains_destructive_command")) {
      console.error("⚠️ [PolicyGate Warning] Inbound response contains potentially destructive shell command(s).");
    }

    console.log(result.turn.markdownContent);

    if (result.canvasDocument) {
      console.log(`\n🎨 [Canvas Document] ${result.canvasDocument.title}`);
    }

    if (result.writtenFiles && result.writtenFiles.length > 0) {
      console.log(`\n📁 Saved ${result.writtenFiles.length} artifact file(s):`);
      for (const f of result.writtenFiles) console.log(`  • ${f}`);
    }

    return 0;
  } catch (err: unknown) {
    console.error(`❌ Ask failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

async function handleCompare(orchestrator: ReturnType<typeof createContainer>["orchestrator"], args: string[]): Promise<number> {
  const parsed = parseCompareArgs(args);
  const prompt = parsed.prompt || (await readStdin());
  if (!prompt.trim()) {
    console.error("Error: Prompt is required for comparison.");
    return 1;
  }
  try {
    const report = await orchestrator.compare({
      prompt, platforms: parsed.platforms, mode: parsed.mode, timeoutMs: parsed.timeoutMs,
      outDir: parsed.outDir, arbitrate: parsed.arbitrate, arbiter: parsed.arbiter,
    });
    console.log(report.markdownReport);
    return 0;
  } catch (err: unknown) {
    console.error(`❌ Comparison failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
