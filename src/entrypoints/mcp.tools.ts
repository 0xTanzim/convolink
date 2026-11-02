import type { SessionOrchestrator } from "../core/services/orchestrator.js";
import type { PlatformId } from "../core/ports/platform.port.js";
import {
  formatDoctorReport,
  runSelfHealingClean,
  getProfilesListText,
  selectProfile,
  ensureMcpBrowserReady,
} from "./mcp.helpers.js";
export { MCP_TOOLS, type McpToolDefinition } from "./mcp.schema.js";

export interface McpToolExecutionResult {
  readonly text: string;
  readonly isError?: boolean;
  readonly writtenFiles?: readonly string[];
  readonly riskLabels?: readonly string[];
  readonly redactedSecretsCount?: number;
}

export interface ExecuteToolOptions {
  readonly workDir?: string;
}

export async function executeMcpTool(
  orchestrator: SessionOrchestrator,
  name: string,
  args: Record<string, unknown> = {},
  options?: ExecuteToolOptions,
): Promise<McpToolExecutionResult> {
  try {
    switch (name) {
      case "convo_ask": {
        const browser = typeof args.browser === "string" ? args.browser : undefined;
        const profile = typeof args.profile === "string" ? args.profile : undefined;
        const browserReady = await ensureMcpBrowserReady(orchestrator, { browser, profile });
        if (!browserReady.ok) {
          return { text: browserReady.errorText ?? "Browser is not ready.", isError: true };
        }
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
        const browser = typeof args.browser === "string" ? args.browser : undefined;
        const profile = typeof args.profile === "string" ? args.profile : undefined;
        const browserReady = await ensureMcpBrowserReady(orchestrator, { browser, profile });
        if (!browserReady.ok) {
          return { text: browserReady.errorText ?? "Browser is not ready.", isError: true };
        }
        const prompt = typeof args.prompt === "string" ? args.prompt : String(args.prompt ?? "");
        const platforms = Array.isArray(args.platforms) ? (args.platforms as PlatformId[]) : undefined;
        const arbitrate = typeof args.arbitrate === "boolean" ? args.arbitrate : undefined;
        const arbiter = typeof args.arbiter === "string" ? (args.arbiter as PlatformId) : undefined;
        const report = await orchestrator.compare({ prompt, platforms, arbitrate, arbiter });
        return { text: report.markdownReport };
      }

      case "convo_doctor": {
        const fix = args.fix === true;
        const fixResult = fix ? await runSelfHealingClean() : undefined;
        const report = await orchestrator.doctor();
        return { text: formatDoctorReport(report, fixResult) };
      }

      case "convo_list_tabs": {
        const tabs = await orchestrator.listTabs();
        const text = tabs.map((t) => `• [${t.platformId ?? "OTHER"}] ${t.title} (Target: ${t.targetId}, URL: ${t.url})`).join("\n");
        return { text: text || "No open tabs found. Call convo_tab({ action: 'new', target: 'deepseek' }) to open one." };
      }

      case "convo_tab": {
        const action = typeof args.action === "string" ? args.action : "";
        if (action === "new") {
          const target = typeof args.target === "string" && args.target.trim() ? args.target.trim() : "chatgpt";
          const tab = await orchestrator.createTab(target);
          return { text: `Spawned tab [${tab.targetId}] for ${tab.url}` };
        }
        if (action === "close") {
          const targetId = typeof args.targetId === "string" ? args.targetId.trim() : "";
          if (!targetId) return { text: "Error: targetId is required for action 'close'. Call convo_list_tabs to view active tab IDs.", isError: true };
          await orchestrator.closeTab(targetId);
          return { text: `Closed tab [${targetId}]` };
        }
        if (action === "back") {
          const targetId = typeof args.targetId === "string" ? args.targetId.trim() : undefined;
          await orchestrator.goBack(targetId);
          return { text: "Navigated active tab back in browser history." };
        }
        if (action === "undo") {
          const targetId = typeof args.targetId === "string" ? args.targetId.trim() : undefined;
          const res = await orchestrator.undo(targetId);
          return { text: res ? `Restored previous conversation URL: ${res.restoredUrl}` : "No previous checkpoint found to restore." };
        }
        return { text: `Error: Invalid action '${action}'. Valid actions: 'new', 'close', 'back', 'undo'.`, isError: true };
      }

      case "convo_search": {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        const limit = typeof args.limit === "number" ? args.limit : 10;
        const results = await orchestrator.searchLedger(query, limit);
        if (results.length === 0) return { text: `No results matching "${query}".` };
        const text = results.map((r) => `• [Thread ${r.threadId}] Turn ${r.turnIndex} (${r.role}):\n  ${r.snippet}`).join("\n\n");
        return { text };
      }

      case "convo_thread": {
        const action = typeof args.action === "string" ? args.action : "";
        if (action === "export") {
          const threadId = typeof args.threadId === "string" ? args.threadId.trim() : "";
          if (!threadId) return { text: "Error: threadId is required for action 'export'. Call convo_search to find historical thread IDs.", isError: true };
          const format = args.format === "json" ? "json" : "markdown";
          const output = await orchestrator.exportThread(threadId, format);
          return { text: output };
        }
        if (action === "resume") {
          const threadId = typeof args.threadId === "string" ? args.threadId.trim() : "";
          if (!threadId) return { text: "Error: threadId is required for action 'resume'. Call convo_search to find historical thread IDs.", isError: true };
          const tab = await orchestrator.resumeThread(threadId);
          return { text: `Reopened saved thread [${threadId}] in tab [${tab.targetId}]: ${tab.url}` };
        }
        if (action === "history") {
          const targetId = typeof args.targetId === "string" ? args.targetId.trim() : undefined;
          const history = orchestrator.getHistory(targetId);
          if (!history || history.length === 0) return { text: "No session history recorded for this tab yet." };
          const lines = history.map((h, i) => `  ${i + 1}. [${h.timestamp}] ${h.url}`);
          return { text: `Session Checkpoints:\n${lines.join("\n")}` };
        }
        return { text: `Error: Invalid action '${action}'. Valid actions: 'export', 'resume', 'history'.`, isError: true };
      }

      case "convo_profile": {
        const action = typeof args.action === "string" ? args.action : "list";
        if (action === "select") {
          const target = typeof args.target === "string" ? args.target : "";
          return selectProfile(target, options?.workDir);
        }
        return { text: await getProfilesListText(options?.workDir) };
      }

      default:
        return { text: `Unknown tool: ${name}. Call tools/list to inspect valid tools.`, isError: true };
    }
  } catch (err: unknown) {
    return { text: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
