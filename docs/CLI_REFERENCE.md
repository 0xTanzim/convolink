# ConvoLink CLI Complete Reference (All 16 Commands)

> **Target Audience:** Terminal engineers, shell scripts, CI/CD runners, and AI agents.  
> **Direct Raw Ingestion URL:** `https://raw.githubusercontent.com/0xTanzim/convolink/main/docs/CLI_REFERENCE.md`

Exhaustive reference for all 16 commands provided by `convo` / `convolink`.

---

## Command Table

| Command | Shorthand / Signature | Description |
| :--- | :--- | :--- |
| **`doctor`** | `convo doctor [--launch]` | Audits CDP latency, open tabs, selector health, and host OS diagnostics. |
| **`list`** | `convo list` | Lists all active browser tabs on supported AI platforms. |
| **`ask`** | `convo ask "<prompt>" [flags]` | Sends prompt to an AI tab, streams completion, and extracts artifacts. |
| **`compare`** | `convo compare "<prompt>" [flags]` | Broadcasts prompt across models with Stage 2 Arbiter consensus synthesis. |
| **`tab new`** | `convo tab new <platform\|url>` | Spawns a clean background tab for an AI platform (e.g. `deepseek`) or URL. |
| **`tab close`** | `convo tab close <targetId>` | Closes a specific tab cleanly without touching the host browser. |
| **`back`** | `convo back [targetId]` | Navigates active tab back in browser history. |
| **`undo`** | `convo undo [targetId]` | Rollbacks an accidental chat reset to the previous conversation checkpoint URL. |
| **`history`** | `convo history [targetId]` | Lists recent checkpoints and thread URLs for a tab. |
| **`resume`** | `convo resume <threadId>` | Rehydrates a past conversation thread into a browser tab from SQLite. |
| **`search`** | `convo search <query> [--limit 10]` | SQLite FTS5 search across conversation ledger turns and code. |
| **`export`** | `convo export <threadId> [--format]` | Exports a thread and code artifacts to Markdown or JSON. |
| **`profile list`** | `convo profile list` | Discovers local Google Chrome, Brave, and Edge profiles with Google emails. |
| **`profile select`**| `convo profile select <id\|email>` | Persists selected browser profile in `.convo/config.json`. |
| **`ext pair`** | `convo ext pair [--rotate]` | Generates/displays cryptographic pairing token for zero-flag extension bridge. |
| **`clean`** | `convo clean` | Terminates orphaned ghost browser processes and clears stale mutex locks. |
| **`mcp`** | `convo mcp [--idle-timeout=15m]` | Runs Model Context Protocol (MCP) JSON-RPC 2.0 stdio server. |

---

## Detailed Flags for Key Commands

### `convo ask`
- `--platform`, `-p`: `chatgpt`, `claude`, `deepseek`, `gemini`.
- `--targetId`, `-t`: Target specific CDP tab ID or shorthand (`#1`, `#2`).
- `--new`, `-n`: Reset tab to fresh chat before submitting prompt.
- `--open-tab`: Spawn brand-new tab in background before submitting.
- `--think` / `--no-think`: Enable or disable deep thinking mode (e.g. DeepSeek R1).
- `--search` / `--no-search`: Enable or disable web search grounding.
- `--write-files`, `-w`: Extract files tagged with `// filepath:` to disk.
- `--out-dir`, `-o`: Output directory for written files (default: `./artifacts`).
- `--transport`: Engine: `raw-cdp` (default), `extension-bridge`, `firefox-bidi`, `agent-browser`.
- `--timeout`: Milliseconds before request timeouts (default: `120000`).
- `--no-continue`: Disable automated multi-chunk stream continuation.

### `convo compare`
- `--platforms`: Comma-separated platforms (default: `chatgpt,deepseek,gemini`).
- `--mode`: `parallel` (default) or `sequential`.
- `--arbitrate`: Trigger Stage 2 Technical Arbiter consensus synthesis.
- `--arbiter`: Designate specific arbiter platform (default: `deepseek`).
- `--out-dir`, `-o`: Directory to save `REPORT.md` and namespaced artifacts.
- `--timeout`: Timeout per model execution in milliseconds (default: `120000`).

### `convo export`
- `--format`: Serialization format: `markdown` (default) or `json`.

## Machine Output and Exit Codes

Every operational command accepts `--json` and then writes exactly one document to
stdout:

```json
{ "ok": true, "command": "ask", "data": { "platform": "deepseek", "text": "..." }, "error": null }
```

On failure the same envelope carries `error` with `code`, `message`, `remediation`,
and `retryable`. Progress is emitted as newline-delimited JSON on stderr, so stdout
stays parseable.

| Exit | Meaning |
|---|---|
| 0 | Success (or a comparison with at least one successful model) |
| 2 | Configuration missing, invalid, or no browser found |
| 3 | Browser unreachable, profile locked, or default-profile blocked |
| 4 | Session contention (another client holds the Firefox session) |
| 5 | Platform not ready, or submission not observed |
| 6 | Internal error |

## `convo setup`

```bash
convo setup                 # interactive selection, verification, persistence
convo setup --show          # resolved browser, profile, transport, and their sources
convo setup --reset         # remove .convo/config.json
convo setup --browser=firefox --profile=/path --no-verify-tab   # agent path, no prompting
```
