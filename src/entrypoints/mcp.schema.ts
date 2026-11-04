/**
 * MCP tool definitions for ConvoLink.
 *
 * Each definition surfaces to the agent via `tools/list`. The description,
 * parameter comments, and outputSchema are the primary mechanism by which the
 * agent learns when and how to call each tool.
 *
 * Design constraints (November 2026 research):
 *   - arXiv 2602.14878: compact, high-signal descriptions improve task success
 *     +5.85pp vs free-form prose. Every description must state: purpose, timing
 *     contract, when-to-call, and what NOT to do.
 *   - MCP spec 2026-07-28: `title` (human display name) and `annotations`
 *     (readOnlyHint, destructiveHint, idempotentHint) are required for
 *     spec-compliant servers.
 *   - dbggr.dev Oct 2026: tool selection accuracy falls from 97% at 3 tools to
 *     ~50% at 18. Every tool description must actively prevent misuse.
 */

/** Tool behaviour hints — MCP spec 2025-03-26 / 2026-07-28. */
export interface McpToolAnnotations {
  /** Tool does not modify state. Default false (assume mutating). */
  readonly readOnlyHint?: boolean;
  /** Modification is destructive or irreversible. Default true (conservative). */
  readonly destructiveHint?: boolean;
  /** Safe to call again with identical arguments. Default false. */
  readonly idempotentHint?: boolean;
  /** Tool interacts with external / open-world entities. Default true. */
  readonly openWorldHint?: boolean;
}

export interface McpToolDefinition {
  readonly name: string;
  /** Human-readable display name shown in agent UIs (MCP 2026-07-28). */
  readonly title: string;
  readonly description: string;
  readonly annotations?: McpToolAnnotations;
  readonly outputSchema?: Record<string, unknown>;
  readonly inputSchema: {
    readonly type: "object";
    readonly properties: Record<string, unknown>;
    readonly required?: readonly string[];
    readonly additionalProperties?: boolean;
  };
}

/** Shared workspaceRoot parameter added to all stateful tools. */
const WORKSPACE_ROOT_PARAM = {
  type: "string",
  description:
    "Absolute path to the project root. Required when the MCP server was started from $HOME or a directory different from the project. Set CONVOLINK_WORKSPACE env var as a persistent alternative.",
} as const;

/** Shared browser + profile params used across multiple tools. */
const BROWSER_PARAM = {
  type: "string",
  enum: ["chrome", "brave", "edge", "chromium", "firefox", "zen"],
  description: "Override browser selection. Usually not needed when .convo/config.json is set.",
} as const;

const PROFILE_PARAM = {
  type: "string",
  description: "Browser profile name, email, or index. Usually not needed when .convo/config.json is set.",
} as const;

export const MCP_TOOLS: readonly McpToolDefinition[] = [
  // ─────────────────────────────────────────────────────────────────────────
  // Core interaction tools
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "convo_ask",
    title: "Ask a Browser AI",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description: [
      "BLOCKING (10–180 s) — Send one prompt to a live browser AI tab and wait for the complete response.",
      "Do NOT call any other tool until this returns.",
      "",
      "AUTONOMOUS & SELF-PROVISIONING: If `platform` is specified (e.g. 'deepseek', 'chatgpt', 'claude', 'gemini'), convo_ask automatically attaches to an existing tab or spawns a new one in the background. You do NOT need to call convo_list_tabs or convo_tab first.",
      "SESSION CONTINUITY: Pass `targetId` from the previous structured.tabId to continue the same tab.",
      "If you have a `threadUrl`, pass it directly — no tab setup needed (skips convo_tab + convo_list_tabs).",
      "",
      "After each call, pin structured.tabId and pass it as `targetId` on all subsequent calls to this session.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        prompt:        { type: "string",  description: "Prompt text to send. Required." },
        platform:      { type: "string",  enum: ["chatgpt", "deepseek", "gemini", "claude"], description: "Target AI platform. Automatically attaches to an existing open tab or spawns one if none exists." },
        targetId:      { type: "string",  description: "CDP targetId from a previous convo_ask structured.tabId. Pass this to continue the same conversation without tab-discovery overhead." },
        threadUrl:     { type: "string",  format: "uri", description: "Full conversation URL to resume (e.g. https://chatgpt.com/c/abc123). Attaches directly — skips convo_tab and convo_list_tabs entirely." },
        think:         { type: "boolean", description: "Enable deep reasoning mode (DeepSeek R1, Claude Extended Thinking, ChatGPT o-series). Increases wait to 30–180 s." },
        search:        { type: "boolean", description: "Enable live web search grounding (ChatGPT Search, DeepSeek DeepSearch)." },
        writeFiles:    { type: "boolean", description: "Extract code blocks to local workspace files (reads '// filepath:' directives from the response)." },
        outDir:        { type: "string",  description: "Output directory for extracted files. Default: ./artifacts" },
        openTab:       { type: "boolean", description: "Force spawning a fresh background tab even if an open tab for this platform already exists." },
        newChat:       { type: "boolean", description: "Reset to a fresh conversation before sending. Destroys current thread context — confirm intent before using." },
        browser:       BROWSER_PARAM,
        profile:       PROFILE_PARAM,
        workspaceRoot: WORKSPACE_ROOT_PARAM,
      },
      required: ["prompt"],
    },
    outputSchema: {
      type: "object",
      properties: {
        tabId:     { type: "string",            description: "PIN THIS — pass as targetId on every subsequent convo_ask call to continue this session without tab rediscovery." },
        platform:  { type: "string",            description: "Platform that responded." },
        threadUrl: { type: ["string", "null"],  description: "Resumable conversation URL for cross-session continuity." },
        threadId:  { type: ["string", "null"],  description: "Internal thread ID for convo_search / convo_thread." },
        elapsedMs: { type: "number",            description: "Wall-clock time the model took to respond." },
        continued: { type: "boolean",           description: "True if this was a continuation of an existing conversation." },
        text:      { type: "string",            description: "Full markdown response from the model." },
      },
      required: ["platform", "tabId", "elapsedMs", "text"],
    },
  },

  {
    name: "convo_compare",
    title: "Compare Across Frontier Models",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    description: [
      "BLOCKING (60–300 s) — Fan a prompt out to multiple AI platforms in parallel, then optionally synthesize consensus via Technical Arbiter.",
      "Do NOT call any other tool until this returns.",
      "To continue existing conversations: set `continue:true` (reuses open managed tabs) or pass `threads:{}` with per-platform URLs.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        prompt:        { type: "string", description: "The task or question to compare across models. Required." },
        platforms:     { type: "array", items: { type: "string", enum: ["chatgpt", "deepseek", "gemini", "claude"] }, description: "Models to compare. Default: [chatgpt, deepseek, gemini]." },
        arbitrate:     { type: "boolean", description: "Execute Stage 2 consensus synthesis via Technical Arbiter after all platforms respond." },
        arbiter:       { type: "string", enum: ["chatgpt", "deepseek", "gemini", "claude"], description: "Designate the arbiter platform for consensus synthesis." },
        browser:       BROWSER_PARAM,
        profile:       PROFILE_PARAM,
        threads: {
          type: "object",
          description: "Per-platform conversation URLs to continue. Omit platforms that should start fresh.",
          properties: {
            chatgpt:  { type: "string", format: "uri" },
            claude:   { type: "string", format: "uri" },
            deepseek: { type: "string", format: "uri" },
            gemini:   { type: "string", format: "uri" },
          },
          additionalProperties: false,
        },
        continue:      { type: "boolean", description: "Reuse currently open managed tabs per platform instead of starting fresh chats." },
        workspaceRoot: WORKSPACE_ROOT_PARAM,
      },
      required: ["prompt"],
    },
    outputSchema: {
      type: "object",
      properties: {
        comparisonId: { type: "string" },
        durationMs:   { type: "number" },
        platforms: {
          type: "array",
          items: {
            type: "object",
            properties: {
              platform:  { type: "string" },
              status:    { type: "string", enum: ["success", "failed", "timeout"] },
              elapsedMs: { type: "number" },
              threadId:  { type: ["string", "null"] },
            },
            required: ["platform", "status", "elapsedMs"],
          },
        },
      },
      required: ["comparisonId", "platforms"],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Status / configuration tools
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "convo_status",
    title: "Read Active Configuration",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    description:
      "Returns the resolved transport, browser, profile, and endpoint for this project, showing the source of each value (project config, user config, or environment). " +
      "Call this to read .convo/config.json — never read the file directly.",
    inputSchema: {
      type: "object",
      properties: { workspaceRoot: WORKSPACE_ROOT_PARAM },
    },
    outputSchema: {
      type: "object",
      properties: {
        ok:    { type: "boolean" },
        setup: {
          type: "object",
          properties: {
            browserId:   { type: "string", enum: ["chrome", "brave", "edge", "chromium", "firefox", "zen"] },
            transport:   { type: "string", enum: ["raw-cdp", "agent-browser", "firefox-bidi", "extension-bridge"] },
            endpoint:    { type: "string" },
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
    title: "Configure Browser & Profile",
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: [
      "Persist browser and profile for this project workspace (writes .convo/config.json).",
      "With no arguments: prompts the user (native modal if elicitation is supported) or returns profile options as text.",
      "With browser + profile arguments: saves config immediately without prompting.",
      "Never edit .convo/config.json directly — use this tool or convo_profile.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        browser:       { type: "string", enum: ["chrome", "brave", "edge", "chromium", "firefox", "zen"], description: "Browser to drive for this project." },
        profile:       { type: "string", description: "Profile directory path, email, or profile id to bind." },
        transport:     { type: "string", enum: ["raw-cdp", "agent-browser", "firefox-bidi", "extension-bridge"], description: "Transport override. Default: extension-bridge." },
        verifyTab:     { type: "boolean", description: "Also verify a platform page in a temporary tab after saving." },
        workspaceRoot: WORKSPACE_ROOT_PARAM,
      },
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Onboarding / health
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "convo_onboard",
    title: "Onboard — Check Session Readiness",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    description: [
      "CALL THIS FIRST on any new session before any browser work.",
      "Returns ok:true when ready, or nextAction with the single step needed.",
      "nextAction.kind: 'command' (you run it), 'user' (human must act — stop and show instruction), 'tool' (call that MCP tool).",
      "Repeat after each action until ok:true. Then do NOT call this again mid-session unless transport-down error occurs.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: { workspaceRoot: WORKSPACE_ROOT_PARAM },
      additionalProperties: false,
    },
  },

  {
    name: "convo_doctor",
    title: "Diagnose Connection Health",
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: [
      "Inspect connection health: remote debugging ports (Chrome :9222, Firefox :9223, Extension :9224), open AI tabs, selector readiness, and active profiles.",
      "Always call with fix:false (default) first to diagnose. Read the report before deciding any action.",
      "WARNING — fix:true: DESTRUCTIVE. Terminates live session locks and kills active browser connections.",
      "Only call fix:true when the user explicitly asks to reset or fix the connection.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        fix:           { type: "boolean", description: "DESTRUCTIVE when true — terminates live session locks and kills browser processes. Default false. Only use on explicit user instruction to reset." },
        browser:       { type: "string", enum: ["chrome", "brave", "edge", "chromium", "firefox", "zen"], description: "Target browser to diagnose. Omit to check all." },
        workspaceRoot: WORKSPACE_ROOT_PARAM,
      },
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Tab management
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "convo_list_tabs",
    title: "List Open AI Tabs",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    description: [
      "Discover open browser tabs managed by ConvoLink.",
      "WHEN TO CALL: Only when you have lost the targetId from a previous convo_ask response.",
      "If you already have a targetId from this session, pass it directly to convo_ask — skip this tool.",
      "Each tab includes: targetId, platform, url, threadId, managed flag.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
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
              url:      { type: "string" },
              threadId: { type: ["string", "null"] },
              managed:  { type: "boolean" },
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
    title: "Tab Lifecycle Management",
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: [
      "Manage browser tab lifecycle. Actions:",
      "  'new'   — Spawn a background AI tab. Use only when convo_list_tabs shows no managed tab for the platform.",
      "  'close' — Close a tab ConvoLink opened. Errors with not-owned if the tab was not opened by ConvoLink.",
      "  'back'  — Navigate the active tab back in browser history.",
      "  'undo'  — Restore the previous conversation URL if an accidental reset occurred.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        action:   { type: "string", enum: ["new", "close", "back", "undo"], description: "Tab action to perform. Required." },
        target:   { type: "string", description: "Platform ('deepseek' | 'chatgpt' | 'gemini' | 'claude') or full URL — for action 'new' only." },
        targetId: { type: "string", description: "CDP targetId of the tab — for actions 'close', 'back', or 'undo'." },
      },
      required: ["action"],
    },
  },

  // ─────────────────────────────────────────────────────────────────────────
  // History / search / thread management
  // ─────────────────────────────────────────────────────────────────────────
  {
    name: "convo_search",
    title: "Search Conversation History",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    description:
      "Full-text FTS5 search across all historical conversation turns, architectural decisions, and extracted code snippets in the local SQLite ledger. " +
      "Use to find a past threadId before calling convo_thread resume, or to retrieve prior architectural context.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query or keywords." },
        limit: { type: "number", description: "Maximum results to return. Default: 10." },
      },
      required: ["query"],
    },
  },

  {
    name: "convo_thread",
    title: "Thread Export / Resume / History",
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: [
      "Manage saved conversation threads. Actions:",
      "  'export'  — Export full thread as Markdown or JSON. Requires threadId (find via convo_search).",
      "  'resume'  — Reopen a saved thread in an active browser tab. Returns a new targetId for further convo_ask calls.",
      "  'history' — List session checkpoints for a tab. Requires targetId.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        action:   { type: "string", enum: ["export", "resume", "history"], description: "Thread action to perform. Required." },
        threadId: { type: "string", description: "Thread ID for 'export' or 'resume'. Find via convo_search." },
        targetId: { type: "string", description: "Tab targetId for 'history' action." },
        format:   { type: "string", enum: ["markdown", "json"], description: "Export format for action 'export'. Default: markdown." },
      },
      required: ["action"],
    },
  },

  {
    name: "convo_profile",
    title: "Browser Profile Management",
    annotations: { readOnlyHint: false, destructiveHint: false },
    description: [
      "List or bind browser profiles (Chrome, Edge, Brave) for this project.",
      "  'list'   — Discover profiles and their account emails.",
      "  'select' — Bind this workspace to a profile (writes .convo/config.json). Pass index, email, or name as target.",
      "In most sessions, call convo_setup instead — it handles profile selection with user prompting built in.",
    ].join("\n"),
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "select"], description: "Profile action. Default: 'list'." },
        target: { type: "string", description: "Profile index (e.g. '1'), account email, or display name — for action 'select'." },
      },
    },
  },
];
