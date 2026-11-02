import type { createContainer } from "../container.js";
import { BrowserDiscoveryService } from "../adapters/browsers/browser-discovery.js";
import { GhostCleanupService } from "../adapters/browsers/ghost-cleanup.js";
import { BrowserLauncherService } from "../adapters/browsers/browser-launcher.js";
import { PlatformEnv } from "../core/env/platform-env.js";
import { BrowserLocator } from "../core/env/browser-locator.js";
import { ConfigService } from "../core/services/config.service.js";
import { DaemonClient } from "../adapters/daemon/daemon-client.js";
import type { DiscoveredTab, DoctorReport } from "../core/services/orchestrator.types.js";
import { resolveLaunchProfile } from "./cli.prompt.js";
export { handleHistory, handleResume, handleExport, handleSearch } from "./cli.storage.js";
export { handleProfile } from "./cli.profile.js";

type Orchestrator = ReturnType<typeof createContainer>["orchestrator"];

export async function handleDoctor(orchestrator: Orchestrator, args: string[]): Promise<number> {
  const config = await new ConfigService().loadConfig();
  const bIdx = args.indexOf("--browser") !== -1 ? args.indexOf("--browser") : args.indexOf("-b");
  const effectiveBrowser = bIdx !== -1 ? args[bIdx + 1] : config?.browser;
  const isGecko = Boolean(effectiveBrowser && (effectiveBrowser.toLowerCase().includes("firefox") || effectiveBrowser.toLowerCase().includes("zen")));
  const port = isGecko ? 9223 : 9222;

  if (args.includes("--launch")) {
    console.log(`🚀 Attempting to auto-launch browser with remote debugging on port ${port}...`);
    const launcher = new BrowserLauncherService();
    const launchProfile = await resolveLaunchProfile(config, effectiveBrowser);
    const launched = await launcher.ensureBrowserRunning({
      port,
      profilePath: launchProfile.profilePath,
      profileDirectory: launchProfile.profileDirectory,
      browser: effectiveBrowser,
    });
    if (launched) {
      console.log(`✅ Browser online with remote debugging on port ${port}.\n`);
    } else {
      console.log("⚠️ Could not auto-launch browser.\n");
    }
  }

  console.log("🔍 Running ConvoLink Doctor...\n");
  const platform = PlatformEnv.detect();
  const binary = BrowserLocator.findBrowserExecutable(effectiveBrowser || "any");
  const distroTag = platform.distro ? ` (${platform.distro})` : "";
  const libcTag = platform.libc ? ` [libc: ${platform.libc}]` : "";
  const wslTag = platform.isWsl ? " [WSL2]" : "";
  console.log(`[Host Environment] OS: ${platform.os}${distroTag}${wslTag} | Arch: ${platform.arch}${libcTag}`);
  const browserLabel = effectiveBrowser ? ` (${effectiveBrowser})` : "";
  console.log(`[Browser Binary] Resolved${browserLabel}: ${binary || "NONE DETECTED"}\n`);

  try {
    const daemon = new DaemonClient();
    let report: DoctorReport;
    if (await daemon.isAlive()) {
      const res = await daemon.sendRequest<DoctorReport>("doctor");
      if (!res.ok) throw new Error(res.error || "Daemon doctor failed");
      report = res.result!;
    } else {
      report = await orchestrator.doctor();
    }
    const transportName = report.transportHealth.adapterId ? report.transportHealth.adapterId.toUpperCase() : "CDP";
    console.log(`[${transportName} Transport] Status: ${report.transportHealth.ok ? "ONLINE" : "OFFLINE"} (Latency: ${report.transportHealth.latencyMs}ms)`);
    console.log(`[Tabs] Found ${report.totalTabs} total open tab(s), ${report.supportedTabs} supported AI tab(s).\n`);

    if (!report.transportHealth.ok) {
      const discovery = new BrowserDiscoveryService();
      const profiles = await discovery.discoverProfiles();
      console.log("📁 Discovered Local Browser Profiles on Disk:");
      for (const p of profiles) {
        const emailTag = p.email ? ` <${p.email}>` : "";
        console.log(`  • [${p.browser}] ${p.name}${emailTag} (${p.profileId})`);
      }
      console.log("\n💡 Remediation:");
      if (
        report.transportHealth.adapterId === "firefox-bidi" ||
        (config?.browser && (config.browser.toLowerCase().includes("firefox") || config.browser.toLowerCase().includes("zen")))
      ) {
        const binName = config?.browser?.toLowerCase().includes("zen") ? "zen" : "firefox";
        console.log(`  1. Start ${config?.browser || "Firefox/Zen"} with: ${binName} -no-remote --remote-debugging-port=9223`);
        console.log("  2. Or use the ConvoLink Companion Extension: run 'convo ext pair' to view your pairing token.");
        console.log("  3. Run 'convo clean' to terminate any accidentally created ghost instances.\n");
      } else {
        console.log("  1. If Chrome is already open, go to: chrome://inspect/#remote-debugging to enable debugging on your active session.");
        console.log("  2. Or use the ConvoLink Companion Extension: run 'convo ext pair' to view your pairing token.");
        console.log("  3. Run 'convo clean' to terminate any accidentally created ghost instances.\n");
      }
      return 1;
    }

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
  let tabs: DiscoveredTab[];
  const daemon = new DaemonClient();
  if (await daemon.isAlive()) {
    const res = await daemon.sendRequest<DiscoveredTab[]>("list");
    if (!res.ok) throw new Error(res.error || "Daemon list failed");
    tabs = res.result ?? [];
  } else {
    tabs = await orchestrator.listTabs();
  }
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
  const daemon = new DaemonClient();
  const useDaemon = await daemon.isAlive();

  if (sub === "new") {
    const target = args[1] || "chatgpt";
    let tab: DiscoveredTab;
    if (useDaemon) {
      const res = await daemon.sendRequest<DiscoveredTab>("tab_new", { target });
      if (!res.ok) throw new Error(res.error || "Daemon failed to create tab");
      tab = res.result!;
    } else {
      tab = await orchestrator.createTab(target);
    }
    console.log(`✨ Created tab [${tab.targetId}] for ${tab.url}`);
    return 0;
  }
  if (sub === "close") {
    if (!args[1]) { console.error("Error: Target ID is required to close tab."); return 1; }
    if (useDaemon) {
      const res = await daemon.sendRequest("tab_close", { targetId: args[1] });
      if (!res.ok) throw new Error(res.error || "Daemon failed to close tab");
    } else {
      await orchestrator.closeTab(args[1]);
    }
    console.log(`🗑️ Closed tab [${args[1]}]`);
    return 0;
  }
  console.error(`Unknown tab subcommand: ${sub}`);
  return 1;
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
