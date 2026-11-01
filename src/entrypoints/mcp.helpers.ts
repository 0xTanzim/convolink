import { BrowserDiscoveryService } from "../adapters/browsers/browser-discovery.js";
import { GhostCleanupService } from "../adapters/browsers/ghost-cleanup.js";
import { ConfigService } from "../core/services/config.service.js";
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

export async function getProfilesListText(): Promise<string> {
  const discovery = new BrowserDiscoveryService();
  const profiles = await discovery.discoverProfiles();
  const config = await new ConfigService().loadConfig();
  const lines = ["Discovered Browser Profiles:"];
  profiles.forEach((p, idx) => {
    const isActive = (config?.profileEmail && p.email === config.profileEmail) ||
      (config?.profilePath && p.userDataDir === config.profilePath);
    const emailTag = p.email ? ` <${p.email}>` : "";
    const activeTag = isActive ? " [ACTIVE IN THIS WORKSPACE]" : "";
    lines.push(`  ${idx + 1}) [${p.browser}] ${p.name}${emailTag}${activeTag}`);
    lines.push(`     Path: ${p.userDataDir}`);
  });
  lines.push("\n💡 Tip: Call convo_profile({ action: 'select', target: '<index|email>' }) to bind a profile.");
  return lines.join("\n");
}

export async function selectProfile(target: string): Promise<McpToolResult> {
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
    return { text: `Error: No profile matched '${trimmed}'. Call convo_profile({ action: 'list' }) to view installed profiles.`, isError: true };
  }

  await new ConfigService().updateConfig({
    profileId: matched.profileId,
    profileEmail: matched.email,
    profilePath: matched.userDataDir,
  });

  const email = matched.email ? ` <${matched.email}>` : "";
  return { text: `Saved active profile for this repository into .convo/config.json: ${matched.name}${email} (${matched.browser})` };
}
