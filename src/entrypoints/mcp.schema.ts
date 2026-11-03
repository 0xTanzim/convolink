export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly outputSchema?: Record<string, unknown>;
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
        browser: { type: "string", enum: ["chrome", "brave", "edge", "chromium", "firefox", "zen"], description: "Preferred browser to use or launch" },
        profile: { type: "string", description: "Optional browser profile name, email, or index to target" },
        threadUrl: { type: "string", format: "uri", description: "Conversation URL to continue (https://chatgpt.com/c/…, https://chat.deepseek.com/a/chat/s/…, https://claude.ai/chat/…)" },
      },
      required: ["prompt"],
    },
    outputSchema: {
      type: "object",
      properties: {
        platform: { type: "string" },
        tabId: { type: "string" },
        threadId: { type: ["string", "null"] },
        threadUrl: { type: ["string", "null"] },
        elapsedMs: { type: "number" },
        continued: { type: "boolean" },
        text: { type: "string" },
      },
      required: ["platform", "tabId", "elapsedMs", "text"],
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
        browser: { type: "string", enum: ["chrome", "brave", "edge", "chromium", "firefox", "zen"], description: "Preferred browser to use or launch" },
        profile: { type: "string", description: "Optional browser profile name, email, or index to target" },
        threads: {
          type: "object",
          description: "Per-platform conversation URLs to continue. Omitted platforms start a fresh chat.",
          properties: {
            chatgpt: { type: "string", format: "uri" },
            claude: { type: "string", format: "uri" },
            deepseek: { type: "string", format: "uri" },
            gemini: { type: "string", format: "uri" },
          },
          additionalProperties: false,
        },
        continue: { type: "boolean", description: "Reuse the currently open conversations instead of starting fresh (default: false)" },
      },
      required: ["prompt"],
    },
    outputSchema: {
      type: "object",
      properties: {
        comparisonId: { type: "string" },
        durationMs: { type: "number" },
        platforms: {
          type: "array",
          items: {
            type: "object",
            properties: {
              platform: { type: "string" },
              status: { type: "string", enum: ["success", "failed", "timeout"] },
              elapsedMs: { type: "number" },
              threadId: { type: ["string", "null"] },
            },
            required: ["platform", "status", "elapsedMs"],
          },
        },
      },
      required: ["comparisonId", "platforms"],
    },
  },
  {
    name: "convo_status",
    description: "Report the browser, profile, transport, and endpoint ConvoLink will use for this project, with the source of each value. Use this before other browser tools to avoid guessing.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        ok: { type: "boolean" },
        setup: {
          type: "object",
          properties: {
            browserId: { type: "string", enum: ["chrome", "brave", "edge", "chromium", "firefox", "zen"] },
            transport: { type: "string", enum: ["raw-cdp", "agent-browser", "firefox-bidi", "extension-bridge"] },
            endpoint: { type: "string" },
            profilePath: { type: "string" },
          },
          required: ["browserId", "transport", "endpoint"],
        },
      },
      required: ["ok"],
    },
  },
  {
    name: "convo_setup",
    description: "Set the browser and profile for this project (for example after the user switches browsers). Never prompts: pass browser and profile explicitly. Verifies the combination before writing .convo/config.json.",
    inputSchema: {
      type: "object",
      properties: {
        browser: { type: "string", enum: ["chrome", "brave", "edge", "chromium", "firefox", "zen"], description: "Browser to drive" },
        profile: { type: "string", description: "Profile directory path or profile id" },
        transport: { type: "string", enum: ["raw-cdp", "agent-browser", "firefox-bidi", "extension-bridge"] },
        verifyTab: { type: "boolean", description: "Also verify a platform page in a temporary tab" },
      },
      required: ["browser"],
    },
  },
  {
    name: "convo_doctor",
    description: "Check ConvoLink health, remote debugging ports (Chrome :9222, Firefox :9223, Extension :9224), open AI tabs, selector readiness, and active browser profiles. Pass fix: true to automatically purge ghost processes and stale mutex locks.",
    inputSchema: {
      type: "object",
      properties: {
        fix: { type: "boolean", description: "When true, automatically terminates orphan ghost browser processes and clears stale lockfiles to self-heal. Default: false" },
        browser: { type: "string", enum: ["chrome", "brave", "edge", "chromium", "firefox", "zen"], description: "Optional target browser to diagnose" },
      },
    },
  },
  {
    name: "convo_list_tabs",
    description: "Inspect all open browser tabs. Returns targetId, platform, title, current URL, threadId, and whether ConvoLink owns the tab. Always call this first before managing tabs.",
    inputSchema: { type: "object", properties: {} },
    outputSchema: {
      type: "object",
      properties: {
        tabs: {
          type: "array",
          items: {
            type: "object",
            properties: {
              targetId: { type: "string" },
              platform: { type: ["string", "null"] },
              url: { type: "string" },
              threadId: { type: ["string", "null"] },
              managed: { type: "boolean" },
            },
            required: ["targetId", "url", "managed"],
          },
        },
      },
      required: ["tabs"],
    },
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
