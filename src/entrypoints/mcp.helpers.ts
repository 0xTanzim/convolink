import { BrowserDiscoveryService } from "../adapters/browsers/browser-discovery.js";
import { BrowserLauncherService } from "../adapters/browsers/browser-launcher.js";
import { GhostCleanupService } from "../adapters/browsers/ghost-cleanup.js";
import { ConfigService } from "../core/services/config.service.js";
import { ProjectConfigAdapter } from "../adapters/config/project-config.adapter.js";
import type { SessionOrchestrator } from "../core/services/orchestrator.js";
import type { DoctorReport } from "../core/services/orchestrator.types.js";

export interface McpToolResult {
  readonly text: string;
  readonly isError?: boolean;
}

export function formatDoctorReport(report: DoctorReport, fixResult?: { killed: number; purged: string[] }): string {
  const lines: string[] = [
    "🔍 ConvoLink Diagnostics Report:",
    `  • Transport Health: ${report.transportHealth.ok ? "ONLINE" : "OFFLINE"} (Latency: ${report.transportHealth.latencyMs}ms)`,
    `  • Tabs Discovered: ${report.totalTabs} total (${report.supportedTabs} supported AI tab(s))`,
  ];

  if (report.tabs.length > 0) {
    lines.push("\nOpen Tabs:");
    for (const t of report.tabs) {
      const p = t.platformId ? `[${t.platformId.toUpperCase()}]` : "[OTHER]";
      const status = t.selectorsOk ? "READY" : "SELECTOR MISMATCH";
      const lock = t.isLocked ? "LOCKED" : "UNLOCKED";
      lines.push(`  • ${p} ${t.title} (${t.targetId}) - Status: ${status}, Mutex: ${lock}`);
    }
  }

  if (fixResult) {
    lines.push("\n🧹 Ghost Cleanup Performed:");
    lines.push(`  • Terminated: ${fixResult.killed} stray process(es)`);
    lines.push(`  • Purged: ${fixResult.purged.length} temporary ghost profile directory/directories`);
  } else if (!report.transportHealth.ok) {
    lines.push("\n💡 Self-Healing Remediation:");
    lines.push("  1. Call convo_doctor({ fix: true }) to auto-kill ghost processes and unlock ports.");
    lines.push("  2. Ensure Google Chrome is running with remote debugging enabled (--remote-debugging-port=9222).");
  }

  return lines.join("\n");
}

export async function runSelfHealingClean(): Promise<{ killed: number; purged: string[] }> {
  const cleaner = new GhostCleanupService();
  const killed = await cleaner.killGhostProcesses();
  const purged = await cleaner.purgeGhostDirectories();
  return { killed, purged };
}

export async function getProfilesListText(workDir?: string): Promise<string> {
  const discovery = new BrowserDiscoveryService();
  const profiles = await discovery.discoverProfiles();
  const config = await new ConfigService(new ProjectConfigAdapter(), workDir).loadConfig();
  const lines = ["Discovered Browser Profiles:"];
  profiles.forEach((p, idx) => {
    const isActive = config?.profilePath
      ? p.userDataDir === config.profilePath
      : Boolean(config?.profileEmail && p.email === config.profileEmail);
    const emailTag = p.email ? ` <${p.email}>` : "";
    const activeTag = isActive ? " [ACTIVE IN THIS WORKSPACE]" : "";
    lines.push(`  ${idx + 1}) [${p.browser}] ${p.name}${emailTag}${activeTag}`);
    lines.push(`     Path: ${p.userDataDir}`);
  });
  lines.push("\n💡 Tip: Call convo_profile({ action: 'select', target: '<index|email>' }) to bind a profile.");
  return lines.join("\n");
}

export async function selectProfile(target: string, workDir?: string): Promise<McpToolResult> {
  const trimmed = target.trim();
  if (!trimmed) {
    return { text: "Error: 'target' argument is required for action 'select'. Call convo_profile({ action: 'list' }) to see options.", isError: true };
  }
  const discovery = new BrowserDiscoveryService();
  const profiles = await discovery.discoverProfiles();
  const idxMatch = trimmed.match(/^#?(\d+)$/);
  const matched = idxMatch && idxMatch[1]
    ? profiles[parseInt(idxMatch[1], 10) - 1]
    : profiles.find((p) => p.email.toLowerCase().includes(trimmed.toLowerCase()) || p.name.toLowerCase().includes(trimmed.toLowerCase()));

  if (!matched) {
    const isEmail = trimmed.includes("@");
    const isPath = trimmed.startsWith("/") || trimmed.startsWith("~") || trimmed.startsWith(".");
    if (isEmail || isPath) {
      await new ConfigService(new ProjectConfigAdapter(), workDir).updateConfig({
        profileId: "Custom",
        profileEmail: isEmail ? trimmed : undefined,
        profilePath: isPath ? trimmed : undefined,
        browser: "Custom",
      });
      return { text: `Saved custom active profile for this repository into .convo/config.json: ${trimmed}` };
    }
    return { text: `Error: No profile matched '${trimmed}'. Call convo_profile({ action: 'list' }) to view installed profiles.`, isError: true };
  }

  const isGecko = matched.browser.toLowerCase().includes("firefox") || matched.browser.toLowerCase().includes("zen");
  await new ConfigService(new ProjectConfigAdapter(), workDir).updateConfig({
    profileId: matched.profileId,
    profileEmail: matched.email,
    profilePath: matched.userDataDir,
    browser: matched.browser,
    transport: isGecko ? "firefox-bidi" : "raw-cdp",
  });

  const email = matched.email ? ` <${matched.email}>` : "";
  return { text: `Saved active profile for this repository into .convo/config.json: ${matched.name}${email} (${matched.browser})` };
}

export interface EnsureMcpBrowserOptions {
  workDir?: string;
  browser?: string;
  profile?: string;
  discoverProfiles?: () => Promise<import("../adapters/browsers/browser-discovery.js").DiscoveredProfile[]>;
  ensureBrowserRunning?: (opts: import("../adapters/browsers/browser-launcher.js").EnsureBrowserOptions) => Promise<boolean>;
}

export interface McpBrowserReadyResult {
  ok: boolean;
  errorText?: string;
  requiresUserSelection?: boolean;
  question?: string;
  options?: string[];
}

export async function ensureMcpBrowserReady(
  orchestrator: SessionOrchestrator,
  optionsOrWorkDir?: string | EnsureMcpBrowserOptions,
): Promise<McpBrowserReadyResult> {
  const opts = typeof optionsOrWorkDir === "string" ? { workDir: optionsOrWorkDir } : (optionsOrWorkDir ?? {});
  const workDir = opts.workDir;

  try {
    const report = await orchestrator.doctor();
    if (report.transportHealth.ok) {
      return { ok: true };
    }
  } catch {}

  const configService = new ConfigService(new ProjectConfigAdapter(), workDir);
  if (opts.profile) {
    await selectProfile(opts.profile, workDir);
  }

  let config = await configService.loadConfig();
  if (!config) {
    const discover = opts.discoverProfiles ?? (() => new BrowserDiscoveryService().discoverProfiles());
    const profiles = await discover();

    if (profiles.length > 0) {
      // A single discovered profile is still a choice the user must make:
      // picking it silently is how a project ends up driving the wrong session.
      const options = profiles.map((p) => `${p.name}${p.email ? ` <${p.email}>` : ""} (${p.browser})`);
      const profileList = await getProfilesListText();
      const question = "Which browser profile do you want active for this project (.convo/config.json)?";

      return {
        ok: false,
        requiresUserSelection: true,
        question,
        options,
        errorText: [
          "⚠️ No browser profile configured for this workspace, and remote debugging is offline.",
          "",
          profileList,
          "",
          "💡 Harness Elicitation: Prompt the user using your harness ask_question / interactive modal:",
          `  • Question: '${question}'`,
          `  • Options: ${JSON.stringify(options)}`,
          "  • Action: Allow Submit, Other (custom write-in path), or Skip.",
          "",
          "After the user submits their choice, persist it via: convo_profile({ action: 'select', target: '<choice>' })",
        ].join("\n"),
      };
    }
  }

  if (!config && !opts.ensureBrowserRunning) {
    return {
      ok: false,
      requiresUserSelection: true,
      question: "Which browser profile should ConvoLink use for this project?",
      options: [],
      errorText: "No browser profile is configured for this workspace. Call convo_setup with { browser, profile }.",
    };
  }

  if (opts.ensureBrowserRunning) {
    await opts.ensureBrowserRunning({
      profilePath: config?.profilePath,
      profileDirectory: config?.profileId,
      browser: opts.browser ?? config?.browser,
    });
  }
  return { ok: true };
}
