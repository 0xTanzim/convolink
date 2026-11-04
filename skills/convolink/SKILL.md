---
name: convolink
description: Drive real, logged-in browsers (Mozilla Firefox, Zen Browser, Google Chrome, Brave, Edge) from an agent to query frontier web models (ChatGPT, Claude, DeepSeek, Gemini). Use when a coding task needs frontier web AI reasoning, deep thinking (--think), multi-model consensus comparison (--arbitrate), or live web search grounding without API keys. Covers MCP tools (convo_ask, convo_compare, convo_setup, convo_doctor) and CLI commands (convo ask, compare, onboard, doctor, setup, export).
license: MIT
compatibility: claude-code, cursor, codex, opencode, antigravity, windsurf
metadata:
  version: 1.3.6
  package: convolink
  homepage: https://0xtanzim.github.io/convolink/
  repository: https://github.com/0xTanzim/convolink
  runtime: bun
  transports: extension-bridge (port 9224), firefox-bidi (port 9223), raw-cdp (port 9222)
  browsers: chrome, firefox, zen, brave, edge, chromium
  platforms: chatgpt, claude, deepseek, gemini
---

## ⚡ Quick-Reference Card

| Goal | MCP Tool | CLI Alternative | Critical Parameters |
|---|---|---|---|
| First use / check readiness | `convo_onboard` | `convo onboard --json` | Obey `nextAction` / exit code contract |
| Check active state & config | `convo_status` | `convo doctor` | Safe, read-only diagnostic |
| Ask prompt (new or continue) | `convo_ask` | `convo ask "..." -p <platform>` | `prompt`, `targetId` (pin this), `think`, `search` |
| Direct thread URL resume | `convo_ask` | `convo ask "..." --thread-url <url>` | `prompt`, `threadUrl` (skips tab discovery) |
| Multi-model comparison | `convo_compare` | `convo compare "..." --arbitrate` | `prompt`, `platforms`, `arbitrate:true` |
| Configure browser/profile | `convo_setup` | `convo setup --browser <id>` | `browser`, `transport`, `saveOnly:true` |
| Tab management | `convo_tab` | `convo tab new\|close\|back` | `action`, `target`, `targetId` |
| Search conversation history | `convo_search` | `convo search "..."` | `query`, `limit` |

> **Config Rule:** Workspace configuration lives strictly in `.convo/config.json`. Never edit this file directly; use `convo_setup` or `convo setup --save-only`.
>
> **Daemon Architecture (v1.3.5):** ConvoLink enforces *Daemon-as-Sole-Session-Owner* with persistent multiplexed IPC and atomic spawn locks. Gecko BiDi single-session conflicts are prevented automatically.

---

# ConvoLink Core Instructions

ConvoLink bridges your autonomous agent to the user's **real, authenticated browser profile**. No API keys, no duplicate sandbox profiles, and no session loss.

### Supported Browsers & Transports
- **Gecko Family (Mozilla Firefox, Zen Browser):** Supported via `extension-bridge` (Port 9224, recommended) or direct `firefox-bidi` (Port 9223).
- **Chromium Family (Chrome, Brave, Edge):** Supported via `extension-bridge` (Port 9224, recommended) or direct `raw-cdp` (Port 9222).

See [references/browsers.md](references/browsers.md) for detailed browser-specific configuration.

---

## Step 0 — Determine State with `convo onboard --json`

Never guess whether ConvoLink is running, paired, or configured. Run:

```bash
convo onboard --json
# Or via bunx/npx if not installed globally:
bunx convolink@latest onboard --json
```

**Branch on the exit code contract:**
- `0`: **Ready.** Proceed to browser tools.
- `2`: **Configuration required.** Browser or profile unselected. Call `convo_setup` or `convo setup --browser <id> --save-only`.
- `3`: **Transport offline.** Daemon not running. Execute `convo daemon start`.
- `4`: **Human action required.** Relay `nextAction.instruction` to the user (e.g. extension token pairing or CAPTCHA). Stop until completed.
- `5`: Browser reached but unresponsive. Check `error.remediation`.
- `6`: Internal error. Report failure; do not loop retries.

---

## Step 1 — Browser Selection & Setup

### For Mozilla Firefox & Zen Browser
1. Ensure the daemon is running: `convo daemon start`.
2. Save workspace browser preference:
   ```bash
   convo setup --browser zen --transport extension-bridge --save-only
   # Or for Firefox:
   convo setup --browser firefox --transport extension-bridge --save-only
   ```
3. Load the temporary extension:
   - In Firefox/Zen, navigate to `about:debugging#/runtime/this-firefox`.
   - Click **"Load Temporary Add-on..."** and select `extensions/convolink-companion/.output/firefox-mv3/manifest.json`.
   - Click the toolbar puzzle icon and connect with the token from `convo ext pair`.

### For Google Chrome, Brave & Edge
1. Save workspace preference:
   ```bash
   convo setup --browser chrome --transport extension-bridge --save-only
   ```
2. In Chrome/Brave/Edge, navigate to `chrome://extensions` (Developer Mode ON).
3. Click **Load unpacked** and select `extensions/convolink-companion/.output/chrome-mv3`.
4. Connect using the token from `convo ext pair`.

---

## Step 2 — Execution & Workflow Rules

### 1. Timing & Blocking Semantics
`convo_ask` and `convo_compare` are **synchronous-blocking operations**.
- Standard prompts: 10–60 s.
- Extended reasoning (`think:true`): 30–180 s.
- Multi-model comparison (`convo_compare` with 3 models): 60–300 s.
- **Rule:** Never spawn parallel calls to the same tab. Wait for the active turn to finish.

### 2. Tab Pinning & Conversational Continuity
To hold a continuous conversation without context drift:
1. On the first turn, execute `convo_ask(prompt, platform: "deepseek")`. (Automatically self-provisions: connects to an existing tab or spawns one in the background — no prior `convo_list_tabs` or `convo_tab` call needed).
2. Inspect the result: read `result.tabId` and `result.threadUrl`.
3. On every subsequent turn, pass `targetId: <tabId>` to maintain the chat thread.
4. If reconnecting across days or workspaces, pass `threadUrl: "<url>"` directly to `convo_ask`.

### 3. Multi-Model Consensus & Arbitration
When comparing competing architectural directions:
```bash
convo compare "Evaluate ClickHouse vs PostgreSQL for timeseries analytics" \
  --platforms chatgpt,claude,deepseek \
  --arbitrate \
  --arbiter claude \
  --json
```

### 4. Code & Artifact Extraction
When you request code implementations, models can output multiple files in one turn. Instruct the model:
`"Output all code files with standard '// filepath: path/to/file.ext' annotations."`
Then run `convo ask "..." --workspace` or pass `writeFiles: true` in `convo_ask` to automatically write the files to disk.

---

## Step 3 — Safety Guardrails & Anti-Patterns to Avoid

- ❌ **Anti-Pattern 1: Spawning ghost browsers.** Never execute `google-chrome` or `firefox` directly from shell to solve connection errors. This launches an unauthenticated ghost process.
- ❌ **Anti-Pattern 2: Killing live sessions.** Never run `convo doctor --fix` or `convo_doctor({ fix: true })` while a turn is active. `--fix` forcibly clears PID locks and terminates active streams.
- ❌ **Anti-Pattern 3: Editing config by hand.** Never write raw JSON directly to `.convo/config.json`. Use `convo_setup` or `convo setup --save-only`.
- ❌ **Anti-Pattern 4: Closing foreign tabs.** ConvoLink tabs enforce ownership checks (`not-owned`). Never attempt to close user tabs that ConvoLink did not open.

---

## Detailed References

- [references/browsers.md](references/browsers.md) — Comprehensive guide for Firefox, Zen Browser, Chrome, Brave, and Edge setup & ports.
- [references/cli.md](references/cli.md) — Exhaustive CLI manual covering all 12 `convo` subcommands and flags.
- [references/mcp.md](references/mcp.md) — Complete Model Context Protocol (MCP) tool catalog, JSON-RPC schemas, and error codes.
- [references/directives.md](references/directives.md) — Code artifact extraction syntax and patterns.
