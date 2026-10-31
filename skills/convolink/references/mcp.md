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

## 2. Available Cognitive Tools

### `convo_ask`
Submit a prompt to an active or background AI browser tab (`chatgpt`, `deepseek`, `gemini`) and await the complete response with extracted code blocks.

**Parameters:**
- `prompt` (*string, required*): The prompt or instructions to send.
- `platform` (*string, optional*): Target platform (`"chatgpt"` | `"deepseek"` | `"gemini"`). If omitted, ConvoLink matches the first ready tab.
- `newChat` (*boolean, optional*): When `true`, resets the session to a fresh chat before submitting.
- `openTab` (*boolean, optional*): When `true`, automatically spawns a new background tab if none is open.
- `think` (*boolean, optional*): Toggles deep thinking / reasoning models (e.g. DeepSeek R1, ChatGPT Think).
- `search` (*boolean, optional*): Toggles web search grounding.

### `convo_compare`
Broadcast a prompt across ChatGPT, DeepSeek, and Gemini in parallel with staggered dispatch, benchmark their outputs, and optionally synthesize a consensus solution via Technical Arbiter.

**Parameters:**
- `prompt` (*string, required*): The prompt or problem to evaluate.
- `platforms` (*array of strings, optional*): Platforms to compare (defaults to `["chatgpt", "deepseek", "gemini"]`).
- `arbitrate` (*boolean, optional*): Execute stage 2 consensus synthesis via Technical Arbiter.
- `arbiter` (*string, optional*): Designate the arbiter platform (e.g. `"deepseek"`).

### `convo_list_tabs`
List all currently open browser tabs with their targetId, platform, title, and thread URLs.

**Parameters:** None.

### `convo_tab_new`
Spawn a fresh background browser tab for an AI platform or URL.

**Parameters:**
- `target` (*string, required*): Platform name (`"deepseek"` | `"chatgpt"` | `"gemini"`) or full web URL.

### `convo_tab_close`
Close a specific browser tab cleanly by targetId.

**Parameters:**
- `targetId` (*string, required*): The tab targetId to close.

### `convo_undo`
Rollback the active conversation to its prior checkpoint URL, safely undoing accidental navigation or chat resets.

**Parameters:**
- `targetId` (*string, optional*): Optional targetId of the tab to roll back.
