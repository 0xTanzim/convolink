# ConvoLink (`convolink` / `convo`)

> **The Missing Link Between Your Web AI and Your IDE Agent.**  
> *Your web chat holds the architectural masterplan. Your IDE agent has the hands to write code. ConvoLink connects them directly—eliminating the exhausting human copy-paste relay.*

[![Runtime](https://img.shields.io/badge/Runtime-Bun%20%3E%3D1.2-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-v7.0%20Strict%20ESM-blue?logo=typescript)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/Tests-286%20passing%20(bun:test)-success)](https://bun.sh)
[![Release](https://img.shields.io/badge/Release-v1.0.0-purple?logo=github)](https://github.com/0xTanzim/convolink/releases/tag/v1.0.0)
[![Documentation](https://img.shields.io/badge/Documentation-Live%20Site-blue)](https://0xtanzim.github.io/convolink/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## ⚡ What is ConvoLink?

When you build non-trivial software today, you work in two disconnected worlds:

```
┌──────────────────────────────────────┐       ┌──────────────────────────────────────┐
│       The Brain (In Web Chat)        │       │         The Hands (In IDE)           │
├──────────────────────────────────────┤       ├──────────────────────────────────────┤
│ ChatGPT, Claude, DeepSeek, Gemini    │       │ Cursor, Claude Code, Antigravity     │
│ • Days of architectural discussions  │       │ • Great at writing & editing files   │
│ • Data models, invariants, edge cases│       │ • But starts with TOTAL AMNESIA      │
│ • Rejected trade-offs and decisions  │       │ • Blind to your web AI research      │
└──────────────────────────────────────┘       └──────────────────────────────────────┘
                   ▲                                               ▲
                   │                                               │
                   └─────────── [ THE DEVELOPER ] ─────────────────┘
                                 (Manual Human Courier)
                      Copies agent doubts to browser →
                      Waits for web AI to formulate specs →
                      Copies code back to terminal...
```

### The Broken Workflow
When you switch to your IDE, your coding agent has **zero connection** to that upstream conversation. You become a manual human courier copying prompts and code back and forth. If you step away, the agent guesses, drifts from your architecture, and breaks your build.

### The ConvoLink Fix
ConvoLink programmatically connects your IDE agents directly to your live browser tabs:

```mermaid
flowchart LR
    Upstream["Live Web AI Chat<br/>(ChatGPT / Claude / DeepSeek / Gemini)"] <==== ConvoLink Bridge & MCP ====> Downstream["Local Coding Agent<br/>(Cursor / Claude Code / Antigravity)"]
```

1. **Your IDE agent queries the web AI for specs:** *"What is the state transition table and error codes we decided on?"*
2. **Your IDE agent reports progress back:** *"Milestone 1 complete. Lock contention detected—should we use TTL or eager release?"*
3. **Your IDE agent borrows web superpowers for $0:** Uses your existing web subscriptions for **extended thinking (DeepSeek R1)**, **live web search**, and **multi-model consensus (`convo compare`)** without per-token API charges.
4. **Zero "Ghost Browsers":** Hooks directly into your **real, everyday authenticated browser profile** (cookies, saved logins, ChatGPT Plus) without blank windows or security warnings.

---

## 🚀 60-Second Quickstart

### 1. Install ConvoLink
```bash
git clone https://github.com/0xTanzim/convolink.git
cd convolink
bun install
bun link  # Exposes `convo` and `convolink` globally
```

### 2. Connect Your Everyday Browser

ConvoLink adheres to the **Zero Ghost Browser Law**: it never opens an unauthenticated blank browser. Pick the method that suits your workflow:

#### Path A: Companion Extension (Recommended — 100% Zero Flags)
Connects directly to your everyday browser without restarting Chrome or adding command-line flags.
1. Download the extension ZIP from [GitHub Releases v1.0.0](https://github.com/0xTanzim/convolink/releases/tag/v1.0.0):
   - **Chrome / Brave / Edge:** `convolink-companion-chrome.zip`
   - **Firefox:** `convolink-companion-firefox.zip`
2. Open `chrome://extensions/` (or `about:debugging` in Firefox), enable **Developer mode**, and click **Load unpacked**.
3. Pair the extension with your local runtime:
   ```bash
   convo ext pair
   ```

#### Path B: Direct CDP Remote Debugging
Connect directly via Chrome DevTools Protocol (CDP):
- **Everyday Chrome (Chrome 144+):** Open `chrome://inspect/#remote-debugging` in your browser and enable remote debugging. Chrome writes its dynamic port to `DevToolsActivePort`, which ConvoLink detects automatically.
- **Linux Users (Fedora / Ubuntu):** Run our native helper script to check or start your session safely:
  ```bash
  ./scripts/fedora-chrome-debug.sh
  ```
- **Dedicated Persistent AI Profile:** If you prefer a standalone browser window that saves all your logins across reboots:
  ```bash
  google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.config/convolink/profiles/ai-profile" &
  ```

### 3. Verify Connection (`convo doctor`)
Audit your setup and inspect open AI tabs:
```bash
convo doctor
```
```text
🔍 Running ConvoLink Doctor...
[CDP Transport] Status: ONLINE (Latency: 1ms)
[Tabs] Found 4 supported AI tab(s):
  • [CHATGPT] Architecture Discussion - ChatGPT (TargetId: A16BE3...) ✅ READY
  • [CLAUDE] Concurrency Refactoring - Claude (TargetId: 44F12A...) ✅ READY
  • [DEEPSEEK] Algorithmic Optimization - DeepSeek (TargetId: 713AD6...) ✅ READY
  • [GEMINI] Cloud Deployment Strategy - Gemini (TargetId: 837BDC...) ✅ READY
```

---

## 🛠️ The 4 Core Commands You Will Actually Use

### 1. Ingest Specs & Resolve Doubts (`convo ask`)
Query the upstream conversation for architectural invariants, or report progress directly:
```bash
convo ask --platform claude \
  "We are ready to implement Milestone 2. Provide the transition table, invariant list, and error codes we decided on during research."
```

### 2. Multi-Model Consensus & Arbitration (`convo compare`)
Broadcast an architectural proposal across **ChatGPT, Claude, DeepSeek, and Gemini in parallel**. Use an Arbiter model to synthesize the final decision:
```bash
convo compare \
  "Evaluate distributed SQLite (Litestream/LiteFS) vs PostgreSQL for a multi-tenant event ledger. Identify single points of failure." \
  --platforms chatgpt,claude,deepseek,gemini \
  --arbitrate \
  --arbiter deepseek \
  --out-dir ./comparison-results
```

### 3. Search Past Decisions Across All Chats (`convo search`)
Search through all past turns and code blocks captured in your local **SQLite FTS5 ledger**:
```bash
convo search "JWT refresh token rotation invariants" --limit 5
```

### 4. Extract Implementation Files Directly to Disk (`-w`)
Automatically extract production files tagged with `// filepath:` directives directly into your repository:
```bash
convo ask --platform claude \
  "Provide the ring buffer implementation with // filepath: src/ring-buffer.ts and // filepath: tests/ring-buffer.test.ts" \
  -w --out-dir .
```

---

## 🔌 IDE & Agent Integration (MCP in 30 Seconds)

ConvoLink includes a native Model Context Protocol (MCP) server over `stdio` (`bin/convolink-mcp.ts`). This gives Cursor, Claude Desktop, and Antigravity native tools to browse tabs, ask questions, and compare models.

### Add to Cursor (`.cursor/mcp.json`) or Claude Desktop Config:
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

---

## 🏗️ Architecture & Operational Safety

- 🎯 **Zero Window-Focus Theft:** Operates silently in the background via CDP lifecycle commands (`Page.setWebLifecycleState: active`). Your typing focus is never interrupted.
- 🔒 **PID-Aware `tmpfs` Mutex Locking:** Prevents prompt collisions using RAM-backed lock files in `$XDG_RUNTIME_DIR/convolink/`. Dead process locks are automatically reclaimed.
- 🛡️ **Outbound Secret Scrubbing:** Automatically scrubs API keys (`sk-...`, `ghp_...`, AWS secrets, `.env` pairs) to `[REDACTED_SECRET]` before transmission.
- 🚪 **Safe Browser Detach:** ConvoLink **never** calls `browser.close()`. It disconnects cleanly, keeping your tabs, sessions, and cookies untouched.
- 🏛️ **Hexagonal Pure Domain Kernel:** `src/core/` contains **0 browser or network imports**, ensuring 100% testability with sub-millisecond in-memory fakes.

---

## 🧪 Testing & Verification

```bash
bun test        # Runs full 286-test suite across 56 test files (100% pass)
bun run typecheck # Strict TypeScript 7 typecheck (0 errors)
```

---

## 📖 Complete Documentation & Architectural ADRs

Visit our official documentation site for complete architectural guides, ADR-001 through ADR-017, and Linux setup:  
👉 **[https://0xtanzim.github.io/convolink/](https://0xtanzim.github.io/convolink/)**

---

## 📄 License

MIT © 2026 Tanzim & ConvoLink Contributors.
