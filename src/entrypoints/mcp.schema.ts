export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
  };
}

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  {
    name: "convo_ask",
    description: "Submit a prompt to an active or background AI browser tab (ChatGPT, DeepSeek, Gemini, Claude) and retrieve the complete generated response and extracted code blocks.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "Prompt text to send to the browser AI" },
        platform: { type: "string", enum: ["chatgpt", "deepseek", "gemini", "claude"], description: "Target AI platform" },
        targetId: { type: "string", description: "Optional targetId of a specific open browser tab" },
        writeFiles: { type: "boolean", description: "Whether to extract and persist code blocks to local workspace" },
        outDir: { type: "string", description: "Destination directory for extracted code blocks" },
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
    description: "Broadcast a prompt across multiple models in parallel, benchmark their outputs, and optionally synthesize a unified consensus solution via Technical Arbiter.",
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
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "convo_tab_new",
    description: "Spawn a fresh background browser tab for an AI platform or URL.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "string", description: "Platform name (deepseek | chatgpt | gemini | claude) or full URL" },
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
  {
    name: "convo_search",
    description: "Perform full-text search across historical conversation turns and code blocks in the SQLite ledger.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or keywords" },
        limit: { type: "number", description: "Maximum number of results (default: 10)" },
      },
      required: ["query"],
    },
  },
  {
    name: "convo_export",
    description: "Export full conversation history and extracted code blocks for a thread ID as Markdown or JSON.",
    inputSchema: {
      type: "object",
      properties: {
        threadId: { type: "string", description: "The thread ID to export" },
        format: { type: "string", enum: ["markdown", "json"], description: "Export format (default: markdown)" },
      },
      required: ["threadId"],
    },
  },
];
