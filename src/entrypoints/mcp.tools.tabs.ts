import type { SessionOrchestrator } from "../core/services/orchestrator.js";
import { isManagedTabRef } from "../adapters/browsers/tab-registry.js";
import type { McpToolExecutionResult } from "./mcp.tools.types.js";

export async function handleListTabs(orchestrator: SessionOrchestrator): Promise<McpToolExecutionResult> {
  const tabs = await orchestrator.listTabs();
  const structured = {
    tabs: tabs.map((tab) => ({
      targetId: tab.targetId,
      platform: tab.platformId,
      title: tab.title,
      url: tab.url,
      threadId: tab.threadId,
      managed: isManagedTabRef(tab),
    })),
  };
  const text = tabs
    .map(
      (tab) =>
        `• [${tab.platformId ?? "OTHER"}] ${tab.title} (Target: ${tab.targetId}, URL: ${tab.url}${
          tab.threadId ? `, thread: ${tab.threadId}` : ""
        })`,
    )
    .join("\n");
  return {
    text: text || "No open tabs found. Call convo_tab({ action: 'new', target: 'deepseek' }) to open one.",
    structured,
  };
}

export async function handleTab(
  orchestrator: SessionOrchestrator,
  args: Record<string, unknown>,
): Promise<McpToolExecutionResult> {
  const action = typeof args.action === "string" ? args.action : "";
  if (action === "new") {
    const target = typeof args.target === "string" && args.target.trim() ? args.target.trim() : "chatgpt";
    const tab = await orchestrator.createTab(target);
    return { text: `Spawned tab [${tab.targetId}] for ${tab.url}`, structured: { ok: true, tab } };
  }
  if (action === "close") {
    const targetId = typeof args.targetId === "string" ? args.targetId.trim() : "";
    if (!targetId) {
      return {
        text: "Error: targetId is required for action 'close'. Call convo_list_tabs to view active tab IDs.",
        isError: true,
        structured: {
          error: {
            code: "invalid-argument",
            message: "targetId is required for action 'close'.",
            nextTool: "convo_list_tabs",
          },
        },
      };
    }
    await orchestrator.closeTab(targetId);
    return { text: `Closed tab [${targetId}]`, structured: { ok: true, targetId } };
  }
  if (action === "back") {
    const targetId = typeof args.targetId === "string" ? args.targetId.trim() : undefined;
    await orchestrator.goBack(targetId);
    return { text: "Navigated active tab back in browser history.", structured: { ok: true } };
  }
  if (action === "undo") {
    const targetId = typeof args.targetId === "string" ? args.targetId.trim() : undefined;
    const res = await orchestrator.undo(targetId);
    return {
      text: res ? `Restored previous conversation URL: ${res.restoredUrl}` : "No previous checkpoint found to restore.",
      structured: { ok: Boolean(res), restoredUrl: res?.restoredUrl ?? null },
    };
  }
  return {
    text: `Error: Invalid action '${action}'. Valid actions: 'new', 'close', 'back', 'undo'.`,
    isError: true,
    structured: {
      error: {
        code: "invalid-argument",
        message: `Invalid action '${action}'. Valid actions: 'new', 'close', 'back', 'undo'.`,
      },
    },
  };
}

export async function handleSearch(
  orchestrator: SessionOrchestrator,
  args: Record<string, unknown>,
): Promise<McpToolExecutionResult> {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const limit = typeof args.limit === "number" ? args.limit : 10;
  const results = await orchestrator.searchLedger(query, limit);
  if (results.length === 0) return { text: `No results matching "${query}".`, structured: { results: [] } };
  const text = results.map((r) => `• [Thread ${r.threadId}] Turn ${r.turnIndex} (${r.role}):\n  ${r.snippet}`).join("\n\n");
  return { text, structured: { results } };
}

export async function handleThread(
  orchestrator: SessionOrchestrator,
  args: Record<string, unknown>,
): Promise<McpToolExecutionResult> {
  const action = typeof args.action === "string" ? args.action : "";
  if (action === "export") {
    const threadId = typeof args.threadId === "string" ? args.threadId.trim() : "";
    if (!threadId) {
      return {
        text: "Error: threadId is required for action 'export'. Call convo_search to find historical thread IDs.",
        isError: true,
        structured: {
          error: {
            code: "invalid-argument",
            message: "threadId is required for action 'export'.",
            nextTool: "convo_search",
          },
        },
      };
    }
    const format = args.format === "json" ? "json" : "markdown";
    const output = await orchestrator.exportThread(threadId, format);
    return { text: output, structured: { ok: true, threadId, format } };
  }
  if (action === "resume") {
    const threadId = typeof args.threadId === "string" ? args.threadId.trim() : "";
    if (!threadId) {
      return {
        text: "Error: threadId is required for action 'resume'. Call convo_search to find historical thread IDs.",
        isError: true,
        structured: {
          error: {
            code: "invalid-argument",
            message: "threadId is required for action 'resume'.",
            nextTool: "convo_search",
          },
        },
      };
    }
    const tab = await orchestrator.resumeThread(threadId);
    return {
      text: `Reopened saved thread [${threadId}] in tab [${tab.targetId}]: ${tab.url}`,
      structured: { ok: true, threadId, tab },
    };
  }
  if (action === "history") {
    const targetId = typeof args.targetId === "string" ? args.targetId.trim() : undefined;
    const history = await orchestrator.getHistory(targetId);
    if (!history || history.length === 0) {
      return { text: "No session history recorded for this tab yet.", structured: { ok: true, history: [] } };
    }
    const lines = history.map((h, i) => `  ${i + 1}. [${h.timestamp}] ${h.url}`);
    return { text: `Session Checkpoints:\n${lines.join("\n")}`, structured: { ok: true, history } };
  }
  return {
    text: `Error: Invalid action '${action}'. Valid actions: 'export', 'resume', 'history'.`,
    isError: true,
    structured: {
      error: {
        code: "invalid-argument",
        message: `Invalid action '${action}'. Valid actions: 'export', 'resume', 'history'.`,
      },
    },
  };
}
