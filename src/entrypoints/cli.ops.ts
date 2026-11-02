import type { createContainer } from "../container.js";
import { BrowserDiscoveryService } from "../adapters/browsers/browser-discovery.js";
import { GhostCleanupService } from "../adapters/browsers/ghost-cleanup.js";
import { BrowserLauncherService } from "../adapters/browsers/browser-launcher.js";
import { PlatformEnv } from "../core/env/platform-env.js";
import { BrowserLocator } from "../core/env/browser-locator.js";
import { DaemonClient } from "../adapters/daemon/daemon-client.js";
import type { DiscoveredTab, DoctorReport } from "../core/services/orchestrator.types.js";
import { loadResolution } from "./config-context.js";
import { buildCapabilities } from "./cli.doctor.js";
import { failureEnvelope, printError, printJson, successEnvelope } from "./cli.output.js";
import type { OutputFlags } from "./cli.query.js";
export { handleHistory, handleResume, handleExport, handleSearch } from "./cli.storage.js";
export { handleProfile } from "./cli.profile.js";

type Orchestrator = ReturnType<typeof createContainer>["orchestrator"];

export async function handleDoctor(
  orchestrator: Orchestrator,
  args: string[],
  flags: OutputFlags = { json: false },
): Promise<number> {
  const resolutionResult = await loadResolution();
  const resolution = resolutionResult.ok ? resolutionResult.value : null;

  if (args.includes("--launch") && resolution) {
    const launched = await new BrowserLauncherService().ensureBrowserRunning({
      port: resolution.port,
      profilePath: resolution.profilePath,
      browser: resolution.browserId,
    });
    if (!flags.json) console.log(launched ? "✅ Browser online.\n" : "⚠️ Could not auto-launch browser.\n");
  }

  try {
    const report = await runDoctor(orchestrator);
    const capabilities = await buildCapabilities({
      resolution,
      transportOk: report.transportHealth.ok,
      ...(report.transportHealth.error ? { transportError: report.transportHealth.error } : {}),
    });

    if (flags.json) {
      printJson(successEnvelope("doctor", {
        configured: resolution,
        capabilities,
        transportHealth: report.transportHealth,
        tabs: report.tabs,
      }));
      return report.transportHealth.ok ? 0 : 3;
    }

    await printHuman(report, capabilities, resolution);
    return report.transportHealth.ok ? 0 : 3;
  } catch (error) {
    if (flags.json) printJson(failureEnvelope("doctor", error));
    return printError(error);
  }
}

async function runDoctor(orchestrator: Orchestrator): Promise<DoctorReport> {
  const daemon = new DaemonClient();
  if (await daemon.isAlive()) {
    const res = await daemon.sendRequest<DoctorReport>("doctor");
    if (res.ok && res.result) return res.result;
  }
  return await orchestrator.doctor();
}

async function printHuman(
  report: DoctorReport,
  capabilities: readonly { id: string; state: "ok" | "fail"; detail: string; remediation?: string }[],
  resolution: { browserId: string; transport: string; endpoint: string } | null,
): Promise<void> {
  const platform = PlatformEnv.detect();
  console.log("🔍 ConvoLink Doctor\n");
  console.log(`[Host Environment] OS: ${platform.os}${platform.distro ? ` (${platform.distro})` : ""} | Arch: ${platform.arch}`);
  console.log(`[Browser Binary] ${resolution ? `${resolution.browserId} via ${resolution.transport}` : "NONE CONFIGURED"}\n`);

  for (const item of capabilities) {
    const badge = item.state === "ok" ? "✅" : "❌";
    console.log(`${badge} ${item.id}: ${item.detail}`);
    if (item.remediation) console.log(`   → ${item.remediation}`);
  }
  console.log(`\n[Transport] ${report.transportHealth.ok ? "ONLINE" : "OFFLINE"} (${report.transportHealth.latencyMs}ms)`);
  console.log(`[Tabs] ${report.totalTabs} open, ${report.supportedTabs} supported\n`);

  for (const tab of report.tabs) {
    const platformBadge = tab.platformId ? `[${tab.platformId.toUpperCase()}]` : "[OTHER]";
    const status = tab.selectorsOk ? "READY" : tab.platformId ? "SELECTOR MISMATCH" : "IGNORED";
    console.log(`• ${platformBadge} ${tab.title}`);
    console.log(`  ${tab.targetId} · ${tab.url}`);
    console.log(`  ${status} · ${tab.isLocked ? "LOCKED" : "UNLOCKED"}\n`);
  }

  if (!report.transportHealth.ok) {
    const profiles = await new BrowserDiscoveryService().discoverProfiles();
    console.log("📁 Profiles on disk:");
    for (const profile of profiles) console.log(`  • [${profile.browser}] ${profile.name} — ${profile.userDataDir}`);
  }
}

export async function handleList(
  orchestrator: Orchestrator,
  flags: OutputFlags = { json: false },
): Promise<number> {
  let tabs: DiscoveredTab[];
  const daemon = new DaemonClient();
  if (await daemon.isAlive()) {
    const res = await daemon.sendRequest<DiscoveredTab[]>("list");
    if (!res.ok) return printError(new Error(res.error || "Daemon list failed"));
    tabs = res.result ?? [];
  } else {
    tabs = await orchestrator.listTabs();
  }

  if (flags.json) {
    printJson(successEnvelope("list", {
      tabs: tabs.map((tab) => ({
        targetId: tab.targetId,
        platform: tab.platformId,
        title: tab.title,
        url: tab.url,
      })),
    }));
    return 0;
  }

  console.log(`Found ${tabs.length} open tab(s):\n`);
  for (const tab of tabs) {
    const platform = tab.platformId ? `[${tab.platformId.toUpperCase()}]` : "[OTHER]";
    console.log(`${platform} ${tab.title}\n  Target: ${tab.targetId}\n  URL: ${tab.url}\n`);
  }
  return 0;
}

export async function handleTab(
  orchestrator: Orchestrator,
  args: string[],
  flags: OutputFlags = { json: false },
): Promise<number> {
  const sub = args[0] || "list";
  if (sub === "list") return handleList(orchestrator, flags);

  const daemon = new DaemonClient();
  const useDaemon = await daemon.isAlive();

  if (sub === "new") {
    const target = args[1] || "chatgpt";
    const tab = useDaemon
      ? (await daemon.sendRequest<DiscoveredTab>("tab_new", { target })).result
      : await orchestrator.createTab(target);
    if (!tab) throw new Error("Daemon failed to create tab");

    if (flags.json) printJson(successEnvelope("tab", { targetId: tab.targetId, url: tab.url }));
    else console.log(`✨ Created tab [${tab.targetId}] for ${tab.url}`);
    return 0;
  }

  if (sub === "close") {
    if (!args[1]) return printError(new Error("Target ID is required to close a tab."));
    if (useDaemon) await daemon.sendRequest("tab_close", { targetId: args[1] });
    else await orchestrator.closeTab(args[1]);

    if (flags.json) printJson(successEnvelope("tab", { closed: args[1] }));
    else console.log(`🗑️ Closed tab [${args[1]}]`);
    return 0;
  }

  return printError(new Error(`Unknown tab subcommand: ${sub}`));
}

export async function handleUndo(orchestrator: Orchestrator, targetId?: string): Promise<number> {
  try {
    const restored = await orchestrator.undo(targetId);
    console.log(restored ? `↩️ Restored previous conversation: ${restored.restoredUrl}` : "No previous checkpoint found to restore.");
  } catch {
    console.log("No previous checkpoint found to restore.");
  }
  return 0;
}

export async function handleClean(): Promise<number> {
  const cleaner = new GhostCleanupService();
  const killed = await cleaner.killGhostProcesses();
  const purged = await cleaner.purgeGhostDirectories();
  console.log("🧹 Ghost Cleanup Complete:");
  console.log(`  • Terminated ${killed} stray ghost browser process(es)`);
  console.log(`  • Purged ${purged.length} temporary ghost profile directory/directories`);
  return 0;
}
