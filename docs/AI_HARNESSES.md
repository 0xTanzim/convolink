# AI Coding Harnesses Integration Guide

> **Target Audience:** Autonomous AI coding agents, developers, and agentic IDEs.  
> **Direct Raw Ingestion URL:** `https://raw.githubusercontent.com/0xTanzim/convolink/main/docs/AI_HARNESSES.md`

ConvoLink bridges autonomous AI coding agents directly to live upstream web AI conversations (ChatGPT, Claude, DeepSeek, Gemini) using standard Model Context Protocol (MCP) JSON-RPC 2.0 over `stdio`.

---

## 1. Universal Harness Configuration Matrix

| Harness | Config Format | Primary Configuration Path | Registration Command |
| :--- | :--- | :--- | :--- |
| **Google Antigravity** | JSON | `~/.gemini/config/mcp_config.json`<br/>*(or `.agents/mcp_config.json`)* | Side Panel > `...` > **MCP Servers** |
| **OpenAI Codex** | TOML | `~/.codex/config.toml` | `codex mcp add convolink -- bunx -y convolink@latest mcp` |
| **Anthropic Claude Code** | JSON | `.claude/mcp.json` | `claude mcp add convolink -- bunx -y convolink@latest mcp` |
| **Cursor IDE** | JSON | `.cursor/mcp.json`<br/>*(or `~/.cursor/mcp.json`)* | Settings > Features > **MCP** |
| **Devin Desktop / Windsurf** | JSON | `~/.config/devin/mcp_config.json`<br/>*(or `.devin/mcp_config.json`)* | Cascade Menu > **Open MCP config file** |
| **Cline / Roo Code** | JSON | Extension Global Storage | Extension Header > **MCP Servers** tab |
| **CommandCode / OpenCode** | JSON | `.mcp/config.json` | Project Root Configuration |
| **Aider & Shell Agents** | Subshell CLI | Native POSIX / PowerShell | `convo ask` / `convo search` piped into prompts |

---

## 2. Configuration Schemas

### Standard JSON Configuration (Cursor, Antigravity, Claude Code, Devin, Cline)
```json
{
  "mcpServers": {
    "convolink": {
      "command": "bunx",
      "args": ["-y", "convolink@latest", "mcp"]
    }
  }
}
```
*(If Bun is not installed, replace `"bunx"` with `"npx"`).*

### OpenAI Codex TOML Configuration (`~/.codex/config.toml`)
```toml
[mcp_servers.convolink]
command = "bunx"
args = ["-y", "convolink@latest", "mcp"]
disabled = false
```

---

## 3. The 8 Composite MCP Tools Exposed

1. `convo_ask`: Submit prompt to web AI with reasoning (`think`) and web search (`search`) toggles; auto-extracts code blocks (`// filepath:`).
2. `convo_compare`: Parallel multi-model benchmarking with Stage 2 Technical Arbiter synthesis (`arbitrate`).
3. `convo_doctor`: Health audit of CDP port 9222, open AI tabs, and active browser profile (`fix: true` auto-purges ghost processes).
4. `convo_list_tabs`: Enumerate open browser tabs with targetId, platform, title, and current URL without window-focus theft.
5. `convo_tab`: Manage tab lifecycles (`action`: `new`, `close`, `back`, `undo`).
6. `convo_search`: Full-text SQLite FTS5 search across historical turns, prompts, and extracted code.
7. `convo_thread`: Manage conversation ledgers (`action`: `export`, `resume`, `history`).
8. `convo_profile`: Discover and bind browser profiles (`action`: `list`, `select`).

---

## 4. Architectural Guarantees for AI Agents

- **Cold Boot Speed:** Boots cold in `< 30ms` with `< 1MB` initial memory footprint.
- **Auto-Shutdown:** Automatically tears down after 15 minutes of inactivity (`--idle-timeout=15m`), leaving zero memory leaks.
- **PID-Aware Mutex Locking:** Locks are stored in RAM (`tmpfs` / `/run/user/<UID>/convolink/`) and self-heal if an agent process dies.
- **Zero Focus Theft:** Tab operations emulate lifecycle states silently in the background without stealing active IDE focus.
- **Secret Redaction:** Outbound prompts pass through `PolicyGatePort`, redacting API keys and tokens before web transmission.
