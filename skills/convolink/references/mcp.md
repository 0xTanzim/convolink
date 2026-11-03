# ConvoLink Model Context Protocol (MCP) Reference

ConvoLink ships with a production-grade Model Context Protocol (MCP) server operating over standard input/output (`stdio`). This allows any MCP-compatible coding agent (e.g. Claude Desktop, Cursor, Antigravity, OpenCode, Windsurf) to control and query authenticated browser AI sessions with zero token cost.

---

## 1. Quick Integration

### Claude Desktop Configuration
Add the following to your `claude_desktop_config.json` (on Linux: `~/.config/Claude/claude_desktop_config.json`, on macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "convolink": {
      "command": "bun",
      "args": ["run", "/absolute/path/to/convolink/bin/convolink-mcp.ts"]
    }
  }
}
```

### Antigravity / Cursor / OpenCode Configuration
Add to your project or user MCP settings (`mcp.json`):

```json
{
  "convolink": {
    "command": "convo",
    "args": ["mcp"]
  }
}
```

---

## 2. First call: `convo_onboard`

Returns `steps[]`, `nextAction` and `requiresUserSelection`. Obey `nextAction`; repeat until
`ok: true`. Never hand-edit `.convo/config.json`.

## 3. Available Cognitive Tools

### `convo_onboard`
Readiness report plus the single next step. `nextAction.kind` is `command` (run it), `user`
(show the instruction, stop) or `tool` (call it with `nextAction.args`).

### `convo_ask`
Submit a prompt to an active or background AI browser tab (`chatgpt`, `claude`, `deepseek`, `gemini`) and await the complete response with extracted code blocks.

**Parameters:**
- `prompt` (*string, required*): The prompt or instructions to send.
- `platform` (*string, optional*): Target platform (`"chatgpt"` | `"claude"` | `"deepseek"` | `"gemini"`). If omitted, ConvoLink matches the first ready tab.
- `targetId` (*string, optional*): Target specific browser tab by CDP target ID.
- `writeFiles` (*boolean, optional*): Automatically extract and persist code blocks to local workspace (default: `false`).
- `outDir` (*string, optional*): Destination directory for extracted code blocks (default: `"./artifacts"`).
- `newChat` (*boolean, optional*): When `true`, resets the session to a fresh chat before submitting.
- `openTab` (*boolean, optional*): When `true`, automatically spawns a new background tab if none is open.
- `think` (*boolean, optional*): Toggles deep thinking / reasoning models (e.g. DeepSeek R1, ChatGPT Think).
- `search` (*boolean, optional*): Toggles web search grounding.

**Return Payload Schema:**
```json
{
  "text": "Generated response markdown...",
  "writtenFiles": ["/path/to/artifacts/file1.ts"],
  "riskLabels": ["contains_shell_execution"],
  "redactedSecretsCount": 0
}
```

### `convo_compare`
Broadcast a prompt across ChatGPT, Claude, DeepSeek, and Gemini in parallel with staggered dispatch, benchmark their outputs, and optionally synthesize a consensus solution via Technical Arbiter.

**Parameters:**
- `prompt` (*string, required*): The prompt or problem to evaluate.
- `platforms` (*array of strings, optional*): Platforms to compare (defaults to `["chatgpt", "deepseek", "gemini"]`).
- `arbitrate` (*boolean, optional*): Execute stage 2 consensus synthesis via Technical Arbiter.
- `arbiter` (*string, optional*): Designate the arbiter platform (e.g. `"deepseek"`).

### `convo_search`
Query the local SQLite FTS5 conversation ledger to find relevant turns, architecture decisions, and code snippets across all past browser conversations.

**Parameters:**
- `query` (*string, required*): Search query or keywords.
- `limit` (*number, optional*): Maximum number of search results to return (default: 10).

### `convo_export`
Export the full turn-by-turn conversation history and extracted code blocks for a specific thread ID as Markdown or JSON.

**Parameters:**
- `threadId` (*string, required*): The UUID or platform thread ID to export.
- `format` (*string, optional*): Output format (`"markdown"` | `"json"`, default: `"markdown"`).

### `convo_list_tabs`
List all currently open browser tabs with their targetId, platform, title, and thread URLs.

**Parameters:** None.

### `convo_tab_new`
Spawn a fresh background browser tab for an AI platform or URL.

**Parameters:**
- `target` (*string, required*): Platform name (`"chatgpt"` | `"claude"` | `"deepseek"` | `"gemini"`) or full web URL.

### `convo_tab_close`
Close a specific browser tab cleanly by targetId.

**Parameters:**
- `targetId` (*string, required*): The tab targetId to close.

### `convo_undo`
Rollback the active conversation to its prior checkpoint URL, safely undoing accidental navigation or chat resets.

**Parameters:**
- `targetId` (*string, optional*): Optional targetId of the tab to roll back.
