import type { SessionOrchestrator } from "../core/services/orchestrator.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "convo_ask",
    description: "Submit a prompt to an active or background AI browser tab (ChatGPT, DeepSeek, Gemini) and retrieve the complete generated response and extracted code blocks.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Prompt text to send to the browser AI" },
        platform: { type: "string", enum: ["chatgpt", "deepseek", "gemini"], description: "Target AI platform" },
        newChat: { type: "boolean", description: "Whether to reset conversation to a fresh chat first" },
        openTab: { type: "boolean", description: "Whether to spawn a new background tab" },
        think: { type: "boolean", description: "Toggle deep thinking mode (e.g. DeepSeek R1)" },
        search: { type: "boolean", description: "Toggle web search grounding" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "convo_compare",
    description: "Broadcast a prompt across ChatGPT, DeepSeek, and Gemini in parallel, benchmark their outputs, and optionally synthesize a unified consensus solution via Technical Arbiter.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The task or prompt to compare across models" },
        platforms: { type: "array", items: { type: "string" }, description: "List of platforms (default: chatgpt, deepseek, gemini)" },
        arbitrate: { type: "boolean", description: "Execute stage 2 consensus synthesis via Technical Arbiter" },
        arbiter: { type: "string", description: "Designate arbiter platform (e.g. deepseek)" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "convo_list_tabs",
    description: "List all open browser tabs with their targetId, platform, title, and thread URLs.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "convo_tab_new",
    description: "Spawn a fresh background browser tab for an AI platform or URL.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Platform name (deepseek | chatgpt | gemini) or full URL" },
      },
      required: ["target"],
    },
  },
  {
    name: "convo_tab_close",
    description: "Close a specific browser tab by targetId.",
    inputSchema: {
      type: "object",
      properties: {
        targetId: { type: "string", description: "The tab targetId to close" },
      },
      required: ["targetId"],
    },
  },
  {
    name: "convo_undo",
    description: "Rollback the active conversation to its prior checkpoint URL, undoing accidental navigation or chat resets.",
    inputSchema: {
      type: "object",
      properties: {
        targetId: { type: "string", description: "Optional targetId of the tab to undo" },
      },
    },
  },
];

export async function executeMcpTool(
  orchestrator: SessionOrchestrator,
  name: string,
  args: Record<string, any> = {},
): Promise<{ text: string; isError?: boolean }> {
  try {
    switch (name) {
      case "convo_ask": {
        const res = await orchestrator.ask({
          prompt: args.prompt,
          platform: args.platform,
          newChat: args.newChat,
          openTab: args.openTab,
          toggles: args.think !== undefined || args.search !== undefined ? { think: args.think, search: args.search } : undefined,
        });
        return { text: res.turn.markdownContent };
      }
      case "convo_compare": {
        const report = await orchestrator.compare({
          prompt: args.prompt,
          platforms: args.platforms,
          arbitrate: args.arbitrate,
          arbiter: args.arbiter,
        });
        return { text: report.markdownReport };
      }
      case "convo_list_tabs": {
        const tabs = await orchestrator.listTabs();
        const text = tabs.map((t) => `• [${t.platformId ?? "OTHER"}] ${t.title} (Target: ${t.targetId}, URL: ${t.url})`).join("\n");
        return { text: text || "No open tabs found." };
      }
      case "convo_tab_new": {
        const tab = await orchestrator.createTab(args.target);
        return { text: `Spawned tab [${tab.targetId}] for ${tab.url}` };
      }
      case "convo_tab_close": {
        await orchestrator.closeTab(args.targetId);
        return { text: `Closed tab [${args.targetId}]` };
      }
      case "convo_undo": {
        const res = await orchestrator.undo(args.targetId);
        return { text: res ? `Restored previous conversation: ${res.restoredUrl}` : "No previous checkpoint found to restore." };
      }
      default:
        return { text: `Unknown tool: ${name}`, isError: true };
    }
  } catch (err: unknown) {
    return { text: `Error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}
