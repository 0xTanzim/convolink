---
name: convolink
description: Bridge live browser sessions with ChatGPT, Claude, DeepSeek, and Gemini to automate prompts, extract code artifacts with // filepath: directives, handle multi-chunk stream continuation, and inspect canvas documents. Use whenever you need to query web AI models from the CLI or agent workflows, write generated files to the workspace, search past conversation history, or tap into live browser tabs.
license: MIT
compatibility: claude-code, cursor, codex, antigravity, windsurf
metadata:
  runtime: bun
  transport: cdp-9222
  platforms: chatgpt, claude, deepseek, gemini
---

# ConvoLink Agent Skill

ConvoLink (`convolink` / `convo`) connects AI coding agents directly to existing, authenticated web sessions of ChatGPT, Claude, DeepSeek, and Google Gemini via Chrome DevTools Protocol (CDP).

Use this skill whenever you need to:
1. **Leverage Active Web Subscriptions:** Query models without metered API token costs or separate API keys.
2. **Generate Multi-File Artifacts:** Automatically extract source code blocks into files using `// filepath:` directives.
3. **Handle Truncated Streams:** Automatically click "Continue generating" and stitch multi-chunk outputs seamlessly.
4. **Inspect Canvas Side-Drawers:** Extract documents directly from ChatGPT Canvas and Gemini side drawers.
5. **Coordinate Concurrent Queries:** Safely run multiple agents against browser tabs using PID-aware `tmpfs` mutex locks.

---

## 1. Quick Diagnostics (`convo doctor`)

Before submitting queries, check whether the local Chrome instance is listening and inspect open AI tabs:

```bash
convo doctor
# Or with the full binary name:
convolink doctor
```

### Healthy Diagnostic Output:
```text
🔍 Running ConvoLink Doctor...

[CDP Transport] Status: ONLINE (Latency: 1ms)
[Tabs] Found 3 total open tab(s), 3 supported AI tab(s).

• [DEEPSEEK] Hello greeting - DeepSeek
  TargetId: 713AD61E2ACB2C39A39AE3EE887A30E3 | ✅ READY | 🔓 UNLOCKED
  URL: https://chat.deepseek.com/a/chat/s/b36a98cc-7205-4cde-a1a0-cfc6c98f35c8
  Layout: deepseek-standard-v1

• [CHATGPT] Greeting response
  TargetId: A16BE3AD1A2B8238DE0B27ECA73F9580 | ✅ READY | 🔓 UNLOCKED
  URL: https://chatgpt.com/c/6ae56dbc-63fc-83ec-bc20-00b69ce6cc33
  Layout: chatgpt-2026-turnkey
```

- **ONLINE:** Chromium is running with `--remote-debugging-port=9222`.
- **READY:** Composer input and send button were successfully located.
- **UNLOCKED:** No other agent is currently querying this tab.

---

## 2. Core Agent Workflows

### 2.1 Querying an AI Model (`convo ask`)
Send a prompt to the first available platform tab:
```bash
convo ask --platform deepseek "Explain hexagonal architecture in 3 bullet points"
```
Or target a specific tab by its unique CDP `targetId`:
```bash
convo ask --targetId 713AD61E2ACB2C39A39AE3EE887A30E3 "Analyze this function"
```

### 2.2 Writing Multi-File Code Artifacts to Disk (`-w` / `--write-files`)
Instruct the model to tag each file with a directive comment on the first line. ConvoLink will strip the directive, create directories recursively, and write the files to the workspace:

```bash
convo ask --platform chatgpt \
  "Write an express server with auth middleware. Put files in separate code blocks with // filepath: src/server.ts and // filepath: src/auth.ts" \
  -w --out-dir ./generated
```

For complete directive syntax, see [references/directives.md](references/directives.md).

### 2.3 Handling Truncated Streams & Continuations
When web models produce large responses and hit output limits (e.g. ChatGPT "Continue generating", DeepSeek continuation trigger), ConvoLink automatically clicks the button, stitches the stream, and returns the full response (up to 5 iterations).

To disable auto-continuation:
```bash
convo ask --platform chatgpt "Output full spec" --no-continue
```

### 2.4 Deep Thinking / Reasoning Mode
Toggle reasoning/thinking models on supported platforms (e.g., DeepSeek R1, ChatGPT Think):
```bash
convo ask --platform deepseek "Solve this complex concurrency problem" --think
```

### 2.5 Fresh Chat & Tab Spawning (`--new` / `--open-tab`)
Start fresh chats or spin up brand new tabs without manual browser navigation:
```bash
# Reset active ChatGPT tab to a clean conversation before submitting
convo ask --platform chatgpt "Start a clean refactoring session" --new

# Spawn a brand new background tab on DeepSeek without stealing focus
convo ask --platform deepseek "Design distributed cache" --open-tab

# Or manually manage tabs:
convo tab new deepseek         # Create tab for DeepSeek
convo tab close <targetId>     # Close specific tab cleanly
```

### 2.6 State Movement & Mistake Rollback (`undo` / `back`)
If an agent makes a mistake by resetting a conversation or navigating away, ConvoLink provides safe recovery:
```bash
# Revert mistaken new-chat/navigation back to the prior conversation URL
convo undo

# Step back in active tab browser history
convo back

# Inspect recent checkpoints and thread URLs
convo history
```

### 2.7 Multi-Browser Transport Selection (`--transport`)
ConvoLink features modular transport adapters covering all major automation protocols:
```bash
# Default: High-performance Chromium CDP WebSocket (<2ms latency, zero dependencies)
convo ask "Refactor auth" --transport raw-cdp

# Firefox WebDriver BiDi: Connects directly to Firefox on port 9222 via W3C WebDriver BiDi
convo ask "Refactor auth" --transport firefox-bidi

# Playwright: Cross-browser automation engine
convo ask "Refactor auth" --transport playwright

# Agent-browser: Leverages installed agent-browser 0.39.2 CLI
convo ask "Refactor auth" --transport agent-browser
```

### 2.8 Multi-Model Comparison & Technical Arbiter (`convo compare`)
Query multiple AI models simultaneously with failure isolation and optional consensus arbitration:
```bash
# Basic comparison across all open tabs
convo compare "Design a production-ready rate limiter in Go"

# Compare specific platforms with custom timeout and artifact output directory
convo compare "Implement distributed lock with Redlock vs single Redis" \
  --platforms chatgpt,deepseek,gemini \
  --mode parallel \
  --out-dir ./reports/dist-lock

# Two-Stage Consensus Arbitration: Stage 1 parallel candidates -> Stage 2 synthesis by Technical Arbiter
convo compare "Write a thread-safe LRU cache in Rust" \
  --platforms chatgpt,gemini,deepseek \
  --arbitrate \
  --arbiter deepseek
```

### 2.9 Durable Turn Ledger, Search & Session Continuity (`search` / `export` / `resume`)
Every conversation turn is durably persisted in `$XDG_DATA_HOME/convolink/ledger.sqlite` via native `bun:sqlite` with WAL mode:
```bash
# Instant full-text search across all past conversations and code snippets
convo search "JWT refresh token rotation" --limit 5

# Export full conversation turns and code blocks as structured Markdown
convo export <threadId> --format md

# Export as JSON context packet
convo export <threadId> --format json

# Re-attach and restore an existing conversation by its saved thread ID
convo resume <threadId>
```

### 2.10 Model Context Protocol (MCP) Server
ConvoLink runs as a production JSON-RPC 2.0 MCP server over `stdio`, exposing browser AI intelligence to Claude Desktop, Cursor, Antigravity, and OpenCode:
```bash
# Launch MCP server from CLI
convo mcp

# Or execute standalone binary directly
bun run bin/convolink-mcp.ts
```
Exposed tools: `convo_ask`, `convo_compare`, `convo_search`, `convo_export`, `convo_list_tabs`, `convo_tab_new`, `convo_tab_close`, `convo_undo`.  
See [references/mcp.md](references/mcp.md) for IDE integration snippets and parameter schemas.

---

## 3. Best Practices for Prompts

To ensure 100% reliable artifact generation across all models, structure your prompt like this:

```text
Please implement the requested solution.
For every file, output a separate code block and place the relative filepath on the very first line:
// filepath: relative/path/to/file.ext
(or # filepath: for python/yaml/bash/dockerfile, <!-- file: --> for markdown/html).
Provide full, production-ready code with no placeholders.
```

---

## 4. Operational Invariants & Safeguards

- **Non-Blocking Execution:** Security checks (secret scrubbing and destructive command detection) never pause `stdio` or block the agent process. Destructive commands are tagged in metadata (`contains_destructive_command: true`).
- **Zero Focus Theft:** All interactions run in the background via CDP lifecycle emulation (`Page.setWebLifecycleState: active`). The developer's active desktop window focus is never interrupted.
- **Safe Detach Semantics:** ConvoLink never closes the browser process (`browser.close()`). It disconnects the WebSocket cleanly, leaving all tabs, cookies, and user sessions intact.
- **PID-Aware Mutexes:** Concurrent executions against the same tab are guarded by lock files in `$XDG_RUNTIME_DIR/convolink/`. Stale locks from crashed processes are automatically reclaimed after verifying PID liveness via `process.kill(pid, 0)`.

---

## 5. Troubleshooting & Error Recovery

| Error / Symptom | Root Cause | Agent Action |
| :--- | :--- | :--- |
| `Cannot connect to CDP on 127.0.0.1:9222` | Chrome is not running with remote debugging | Inform the user to run `./scripts/fedora-chrome-debug.sh` or launch Chrome with `--remote-debugging-port=9222`. |
| `No active tab matching platform: <name>` | The requested web app is not open | Ask the user to open `chatgpt.com`, `claude.ai`, `chat.deepseek.com`, or `gemini.google.com` in their browser. |
| `Tab is currently locked by PID <PID>` | Another process is using the tab | Wait 5–10 seconds and retry, or verify if the holding PID is still active. |
| `Timeout waiting for response` | Generation exceeded timeout limit | Re-run with `--timeout 180000` or check if the tab was intercepted by a manual verification challenge. |
