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
    description: "Submit a prompt to an AI browser tab (ChatGPT, DeepSeek, Gemini, Claude) with deep reasoning and web grounding. Automatically extracts and persists generated code blocks to local workspace files.",
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
        think: { type: "boolean", description: "Toggle deep thinking/reasoning mode (e.g. DeepSeek Reasoner, Claude Thinking, ChatGPT o-series)" },
        search: { type: "boolean", description: "Toggle live web search/DeepSearch grounding" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "convo_compare",
    description: "Benchmark a task across multiple frontier models in parallel and optionally synthesize a unified consensus solution via Technical Arbiter.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The task or prompt to compare across models" },
        platforms: { type: "array", items: { type: "string", enum: ["chatgpt", "deepseek", "gemini", "claude"] }, description: "Models to compare" },
        arbitrate: { type: "boolean", description: "Execute stage 2 consensus synthesis via Technical Arbiter" },
        arbiter: { type: "string", enum: ["chatgpt", "deepseek", "gemini", "claude"], description: "Designate arbiter platform" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "convo_doctor",
    description: "Check ConvoLink health, Chrome remote debugging port 9222, open AI tabs, selector readiness, and active browser profiles. Pass fix: true to automatically purge ghost Chrome processes and stale mutex locks.",
    inputSchema: {
      type: "object",
      properties: {
        fix: { type: "boolean", description: "When true, automatically terminates orphan ghost browser processes and clears stale lockfiles to self-heal. Default: false" },
      },
    },
  },
  {
    name: "convo_list_tabs",
    description: "Inspect all open browser tabs. Returns targetId, platform, title, and current URL. Always call this first before managing tabs.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "convo_tab",
    description: "Manage browser tabs: spawn a new background AI tab ('new'), close an idle tab ('close'), navigate back ('back'), or rollback accidental chat resets ('undo').",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["new", "close", "back", "undo"], description: "Tab action to perform" },
        target: { type: "string", description: "Platform name ('deepseek' | 'chatgpt' | 'gemini' | 'claude') or full URL for action 'new'" },
        targetId: { type: "string", description: "Target ID of the tab for actions 'close', 'back', or 'undo'" },
      },
      required: ["action"],
    },
  },
  {
    name: "convo_search",
    description: "Execute full-text FTS5 search across all historical conversation turns and extracted code snippets in the local SQLite ledger.",
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
    name: "convo_thread",
    description: "Manage conversation threads: export thread history as Markdown or JSON ('export'), reopen a saved thread from SQLite into an active browser tab ('resume'), or inspect session checkpoints ('history').",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["export", "resume", "history"], description: "Thread action to perform" },
        threadId: { type: "string", description: "Thread ID for 'export' or 'resume'" },
        targetId: { type: "string", description: "Tab targetId for 'history'" },
        format: { type: "string", enum: ["markdown", "json"], description: "Export format for action 'export' (default: markdown)" },
      },
      required: ["action"],
    },
  },
  {
    name: "convo_profile",
    description: "Inspect and manage host browser profiles (Google Chrome, Edge, Brave): discover profiles and account emails ('list'), or bind the active workspace to a specific profile ('select').",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "select"], description: "Profile action (default: 'list')" },
        target: { type: "string", description: "Profile index (e.g. '1'), account email, or name for action 'select'" },
      },
    },
  },
];
