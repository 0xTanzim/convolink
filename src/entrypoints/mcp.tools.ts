import type { SessionOrchestrator } from "../core/services/orchestrator.js";
import type { PlatformId } from "../core/ports/platform.port.js";
import { BrowserDiscoveryService } from "../adapters/browsers/browser-discovery.js";
import { ConfigService } from "../core/services/config.service.js";
export { MCP_TOOLS, type McpToolDefinition } from "./mcp.schema.js";

export interface McpToolExecutionResult {
  readonly text: string;
  readonly isError?: boolean;
  readonly writtenFiles?: readonly string[];
  readonly riskLabels?: readonly string[];
  readonly redactedSecretsCount?: number;
}

export async function executeMcpTool(
  orchestrator: SessionOrchestrator,
  name: string,
  args: Record<string, unknown> = {},
): Promise<McpToolExecutionResult> {
  try {
    switch (name) {
      case "convo_ask": {
        const prompt = typeof args.prompt === "string" ? args.prompt : String(args.prompt ?? "");
        const platform = typeof args.platform === "string" ? (args.platform as PlatformId) : undefined;
        const targetId = typeof args.targetId === "string" ? args.targetId : undefined;
        const writeFiles = typeof args.writeFiles === "boolean" ? args.writeFiles : undefined;
        const outDir = typeof args.outDir === "string" ? args.outDir : undefined;
        const newChat = typeof args.newChat === "boolean" ? args.newChat : undefined;
        const openTab = typeof args.openTab === "boolean" ? args.openTab : undefined;
        const think = typeof args.think === "boolean" ? args.think : undefined;
        const search = typeof args.search === "boolean" ? args.search : undefined;

        const res = await orchestrator.ask({
          prompt, platform, targetId, writeFiles, outDir, newChat, openTab,
          toggles: think !== undefined || search !== undefined ? { think, search } : undefined,
        });
        return {
          text: res.turn.markdownContent,
          writtenFiles: res.writtenFiles ?? [],
          riskLabels: res.riskLabels,
          redactedSecretsCount: res.redactedSecretsCount,
        };
      }
      case "convo_compare": {
        const prompt = typeof args.prompt === "string" ? args.prompt : String(args.prompt ?? "");
        const platforms = Array.isArray(args.platforms) ? (args.platforms as PlatformId[]) : undefined;
        const arbitrate = typeof args.arbitrate === "boolean" ? args.arbitrate : undefined;
        const arbiter = typeof args.arbiter === "string" ? (args.arbiter as PlatformId) : undefined;
        const report = await orchestrator.compare({ prompt, platforms, arbitrate, arbiter });
        return { text: report.markdownReport };
      }
      case "convo_list_tabs": {
        const tabs = await orchestrator.listTabs();
        const text = tabs.map((t) => `• [${t.platformId ?? "OTHER"}] ${t.title} (Target: ${t.targetId}, URL: ${t.url})`).join("\n");
        return { text: text || "No open tabs found." };
      }
      case "convo_tab_new": {
        const target = typeof args.target === "string" ? args.target : String(args.target ?? "");
        const tab = await orchestrator.createTab(target);
        return { text: `Spawned tab [${tab.targetId}] for ${tab.url}` };
      }
      case "convo_tab_close": {
        const targetId = typeof args.targetId === "string" ? args.targetId : String(args.targetId ?? "");
        await orchestrator.closeTab(targetId);
        return { text: `Closed tab [${targetId}]` };
      }
      case "convo_undo": {
        const targetId = typeof args.targetId === "string" ? args.targetId : undefined;
        const res = await orchestrator.undo(targetId);
        return { text: res ? `Restored previous conversation: ${res.restoredUrl}` : "No previous checkpoint found to restore." };
      }
      case "convo_search": {
        const query = typeof args.query === "string" ? args.query : String(args.query ?? "");
        const limit = typeof args.limit === "number" ? args.limit : 10;
        const results = await orchestrator.searchLedger(query, limit);
        if (results.length === 0) return { text: `No results matching "${query}".` };
        const text = results.map((r) => `• [Thread ${r.threadId}] Turn ${r.turnIndex} (${r.role}):\n  ${r.snippet}`).join("\n\n");
        return { text };
      }
      case "convo_export": {
        const threadId = typeof args.threadId === "string" ? args.threadId : String(args.threadId ?? "");
        const format = args.format === "json" ? "json" : "markdown";
        const output = await orchestrator.exportThread(threadId, format);
        return { text: output };
      }
      case "convo_profile_list": {
        const discovery = new BrowserDiscoveryService();
        const profiles = await discovery.discoverProfiles();
        const configService = new ConfigService();
        const config = await configService.loadConfig();

        const lines = ["Discovered Browser Profiles:"];
        profiles.forEach((p, idx) => {
          const num = idx + 1;
          const isActive = (config?.profileEmail && p.email === config.profileEmail) ||
            (config?.profilePath && p.userDataDir === config.profilePath);
          const activeTag = isActive ? " [ACTIVE IN THIS WORKSPACE]" : "";
          const emailTag = p.email ? ` <${p.email}>` : "";
          lines.push(`  ${num}) [${p.browser}] ${p.name}${emailTag}${activeTag}`);
          lines.push(`     Path: ${p.userDataDir}`);
        });

        lines.push("\n💡 Agent Instruction: Use your native question UI (e.g. ask_question or AskUserQuestion) to let the human user select which profile to link, then call convo_profile_select with their choice.");
        return { text: lines.join("\n") };
      }
      case "convo_profile_select": {
        const target = typeof args.target === "string" ? args.target.trim() : "";
        if (!target) return { text: "Error: target argument is required.", isError: true };
        const discovery = new BrowserDiscoveryService();
        const profiles = await discovery.discoverProfiles();
        const idxMatch = target.match(/^#?(\d+)$/);
        const matched = idxMatch && idxMatch[1]
          ? profiles[parseInt(idxMatch[1], 10) - 1]
          : profiles.find((p) => p.email.toLowerCase().includes(target.toLowerCase()) || p.name.toLowerCase().includes(target.toLowerCase()));

        if (!matched) return { text: `Error: No profile matched '${target}'. Run convo_profile_list to see options.`, isError: true };

        const configService = new ConfigService();
        await configService.updateConfig({
          profileId: matched.profileId,
          profileEmail: matched.email,
          profilePath: matched.userDataDir,
        });

        const email = matched.email ? ` <${matched.email}>` : "";
        return { text: `Saved active profile for this repository into .convo/config.json: ${matched.name}${email} (${matched.browser})` };
      }
      default:
        return { text: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err: unknown) {
    return { text: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
