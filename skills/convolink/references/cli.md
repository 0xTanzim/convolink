# ConvoLink CLI Reference

The `convo` CLI provides agentic and human interfaces for controlling browser-backed AI conversations, profile configuration, and session journals.

---

## Command Catalog

### 1. `convo ask`
Send a single prompt to a supported AI platform (ChatGPT, Claude, DeepSeek, Gemini) and wait for the settled response.

```bash
convo ask "Explain raft consensus" -p deepseek --json
convo ask "Analyze architecture" -p chatgpt --think --search --json
convo ask "Continue analysis" --target-id <tabId> --json
convo ask "Review code" --thread-url "https://chatgpt.com/c/12345" --json
```

**Key Options:**
- `-p, --platform <name>`: Target platform (`chatgpt`, `claude`, `deepseek`, `gemini`).
- `--target-id <id>`: Pin to an existing tab (preserves multi-turn conversational context).
- `--thread-url <url>`: Direct resume URL (bypasses tab discovery entirely).
- `--think`: Enable deep thinking / reasoning mode (DeepSeek reasoning, Claude extended thinking, ChatGPT thinking).
- `--search`: Enable live web search grounding.
- `--workspace, --write-files`: Extract code blocks with `// filepath:` directives into local workspace.
- `--out-dir <path>`: Destination directory for extracted artifacts (default: `./artifacts`).
- `--json`: Emit structured JSON envelope: `{ ok, command, data, error }`.
- `--continue`: Automatically attach to the latest open managed tab for that platform.
- `--timeout <ms>`: Override default generation wait timeout.

---

### 2. `convo compare`
Fan-out a single prompt across multiple frontier models in parallel, with optional Stage-2 Arbiter consensus synthesis.

```bash
# Compare ChatGPT, Claude, and DeepSeek
convo compare "Design a distributed rate limiter" \
  --platforms chatgpt,claude,deepseek \
  --arbitrate \
  --arbiter claude \
  --continue \
  --json
```

**Key Options:**
- `-p, --platforms <list>`: Comma-separated platform list.
- `--arbitrate`: Launch Stage 2 consensus evaluation synthesizing the strengths and weaknesses of each response.
- `--arbiter <platform>`: Select which platform acts as the judge (default: `chatgpt`).
- `--continue`: Reuse open managed tabs rather than launching fresh tabs.

---

### 3. `convo onboard`
The non-negotiable entry point for automated agents. Reports complete system readiness and emits a deterministic single next action.

```bash
convo onboard --json
```

**Exit Codes:**
- `0`: Ready to use browser tools.
- `2`: Configuration issue (e.g., profile not selected).
- `3`: Transport offline (daemon not running).
- `4`: Human action required in browser (e.g., paste token, solve CAPTCHA).
- `5`: Browser reached but not usable.
- `6`: Internal error.

---

### 4. `convo setup`
Declarative or interactive configuration for workspace browser, profile, and transport.

```bash
# Declarative / Offline setup (saves .convo/config.json without probing browser socket)
convo setup --browser zen --transport extension-bridge --save-only
convo setup --browser firefox --transport extension-bridge --save-only
convo setup --browser chrome --transport extension-bridge --save-only

# Direct CDP setup for dev profile
convo setup --browser chrome --transport raw-cdp --port 9222 --save-only
```

**Key Options:**
- `--browser <id>`: `chrome`, `firefox`, `zen`, `brave`, `edge`, `chromium`.
- `--profile <path|id>`: Target profile path or identifier.
- `--transport <type>`: `extension-bridge`, `firefox-bidi`, `raw-cdp`, `agent-browser`.
- `--save-only, --no-verify`: Save configuration file without socket verification.
- `--work-dir <path>`: Explicit workspace root directory.

---

### 5. `convo daemon`
Manage the background bridge daemon that hosts the extension WebSocket server on port 9224.

```bash
convo daemon status       # Check if daemon is active
convo daemon start        # Launch background daemon process
convo daemon stop         # Safely terminate background daemon
```

---

### 6. `convo ext`
Manage Companion Extension cryptographic pairing and state.

```bash
convo ext pair            # Display current 32-byte pairing token and instructions
convo ext pair --rotate   # Invalidate old token and issue a fresh pairing token
convo ext status          # Check if extension is connected and active
```

---

### 7. `convo doctor`
Perform deep system diagnostics, check socket connections, verify selector health, and inspect open tabs.

```bash
convo doctor              # Safe, read-only diagnostic check
convo doctor --fix        # Self-heal (reclaims stale locks, cleans dead processes)
```
> **CAUTION:** `--fix` cleans live locks. Never run `--fix` mid-turn while a conversation is streaming.

---

### 8. `convo tab`
Low-level browser tab lifecycle operations.

```bash
convo tab list            # Discover open tabs and target IDs
convo tab new <platform>  # Open a new tab for deepseek, chatgpt, claude, or gemini
convo tab close <id>      # Close managed tab (enforces 'not-owned' security check)
convo tab focus <id>      # Set active tab
convo tab back <id>       # Navigate backward in tab history
convo tab undo <id>       # Restore tab URL before accidental navigation
```

---

### 9. `convo profile`
Discover and manage browser user profiles.

```bash
convo profile list        # Discovers all Chrome, Firefox, Zen, Brave profiles with emails
convo profile select <id> # Bind profile to current workspace
```

---

### 10. `convo export` & `convo search`
Query and export from the durable SQLite FTS5 conversation ledger.

```bash
# Full-text search across all previous agent turns
convo search "database migration strategy" --limit 10

# Export conversation thread
convo export <threadId> --format markdown -o thread.md
convo export <threadId> --format json
```

---

### 11. `convo clean`
Emergency cleanup of orphaned browser processes and stale PID locks in `$XDG_RUNTIME_DIR/convolink/`.

```bash
convo clean
```

---

### 12. `convo mcp`
Starts the Model Context Protocol stdio server for AI coding agents.

```bash
convo mcp
convo mcp --idle-timeout 30m
```
