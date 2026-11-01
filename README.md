# ConvoLink (`convolink` / `convo`)

> **Your AI Architect and Coding Agent. Finally Connected.**  
> *Your web chat holds the architectural masterplan. Your IDE agent has the hands to write code. ConvoLink connects them directly—eliminating the exhausting human copy-paste relay.*

[![Runtime](https://img.shields.io/badge/Runtime-Bun%20%3E%3D1.2-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-v7.0%20Strict%20ESM-blue?logo=typescript)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/Tests-286%20passing%20(bun:test)-success)](https://bun.sh)
[![Release](https://img.shields.io/badge/Release-v1.0.0-purple?logo=github)](https://github.com/0xTanzim/convolink/releases/tag/v1.0.0)
[![Documentation](https://img.shields.io/badge/Documentation-Live%20Site-blue)](https://0xtanzim.github.io/convolink/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## ⚡ The Core Problem: The Human Context-Relay Trap

When building software with AI today, developers work in two disconnected worlds:

```text
┌──────────────────────────────────────────────┐       ┌──────────────────────────────────────────────┐
│       The Architectural Brain (Web AI)       │       │           The Coding Hands (IDE)             │
├──────────────────────────────────────────────┤       ├──────────────────────────────────────────────┤
│ ChatGPT Plus, Claude Pro, DeepSeek, Gemini   │       │ Cursor, Claude Code, Antigravity, Shell      │
│ • Holds days of accumulated research & ADRs  │       │ • Great at editing files & running tests     │
│ • State machines, schemas, security rules    │       │ • But starts with TOTAL AMNESIA              │
│ • Rejected trade-offs and domain invariants  │       │ • Blind to your web AI research & masterplan │
└──────────────────────────────────────────────┘       └──────────────────────────────────────────────┘
                       ▲                                                       ▲
                       │                                                       │
                       └────────────────── [ THE DEVELOPER ] ──────────────────┘
                                         (Manual Context Courier)
                          Copies agent doubts & logs to browser →
                          Waits for web AI to formulate specs & invariants →
                          Copies architectural direction back to IDE...
```

### Why Disconnected Agents Fail
1. **Architectural Amnesia:** When you open Cursor or Claude Code, the agent has zero connection to your upstream web research. When it hits an architectural boundary, you must manually copy its questions to the browser, wait for the web AI to specify the data model or flow, and copy the specifications back to your IDE.
2. **Architectural Drift:** If you step away or miss relaying a doubt, the local agent makes assumptions, drifts from your agreed masterplan, and writes conflicting code.
3. **The Intelligence Bottleneck:** Local agents running smaller or cost-effective models struggle with complex concurrency, distributed systems, or difficult debugging. But metered API tokens for frontier models are expensive.

**Why should your IDE agent be trapped in isolation when you already subscribe to world-class reasoning, live web search, and deep research in your browser?**

---

## 💡 The Solution: ConvoLink

ConvoLink bridges your IDE agents directly to your live browser tabs across **Three Core Product Pillars**:

```mermaid
flowchart LR
    Upstream["Live Web AI Chat<br/>(ChatGPT / Claude / DeepSeek / Gemini)"] <-->|"ConvoLink Bridge & MCP"| Downstream["Local Coding Agent<br/>(Cursor / Claude Code / Antigravity)"]
```

### 1. 🌉 The Context Bridge
Streams architectural specifications, state invariants, data schemas, and design trade-offs directly into local agents on demand, while symmetrically reporting milestone progress and discovered constraints back upstream to the web AI conversation.

### 2. 🧠 The Intelligence Bridge
Allows local coding agents running smaller or cost-effective models to delegate complex algorithmic reasoning, tricky debugging, and architectural judgment to powerful frontier web models.

### 3. ⚡ The Capability Bridge
Allows local agents to borrow upstream web capabilities—**extended thinking (DeepSeek R1, OpenAI o-series)**, **live web search grounding**, **deep research**, and **multi-model cross-validation**—using your existing authenticated web subscriptions with zero per-token API charges.

---

### Upstream Capability Borrowing Matrix

| Upstream Web AI Capability | What Your Local Coding Agent Gains |
| :--- | :--- |
| **Living Architectural Context** | Direct access to 1-2 days of accumulated R&D, ADRs, rejected trade-offs, and masterplan specifications without manual copy-pasting. |
| **Extended Thinking / Deep Reasoning** | Thorough, multi-step analysis of difficult concurrency race conditions, algorithmic bottlenecks, and formal invariants (`--think`). |
| **Live Web Search Grounding** | Real-time web intelligence: latest library releases, breaking changes, deprecation notices, and official migration guides. |
| **Multi-Model Consensus & Arbitration** | Cross-validates high-risk architectural decisions across Claude, ChatGPT, DeepSeek, and Gemini in parallel with Stage 2 Arbiter synthesis (`convo compare --arbitrate`). |
| **Automated Code Artifact Extraction** | When the upstream architect outputs production files with `// filepath:`, ConvoLink writes them directly into your repo (`-w`). |

---

## 🚀 60-Second Quickstart

### 1. Run Instantly or Install Globally
```bash
# Run instantly with zero setup:
bunx -y convolink@latest doctor

# Or install globally:
bun add -g convolink
# (or: npm install -g convolink)
```

### 2. Connect Your Real Browser (Zero "Ghost Browsers")

ConvoLink adheres to the **Zero Ghost Browser Law**: it never spawns unauthenticated blank browser profiles. It connects directly to your existing authenticated sessions:

#### Path A: Companion Extension (Recommended — 100% Zero Flags)
Connects directly to your everyday browser session with **zero Chrome startup flags** and **zero browser restarts**.
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
- **Everyday Chrome (Chrome 144+):** Open `chrome://inspect/#remote-debugging` in your everyday Chrome and toggle remote debugging. Chrome writes its dynamic port to `DevToolsActivePort`, which ConvoLink detects automatically.
- **Linux Native Helper (Fedora / Ubuntu):** Run our native script to inspect running sessions or launch safely:
  ```bash
  ./scripts/fedora-chrome-debug.sh
  ```
- **Dedicated Persistent AI Profile:** If you prefer a standalone browser window that saves all your logins across reboots:
  ```bash
  google-chrome --remote-debugging-port=9222 --user-data-dir="$HOME/.config/convolink/profiles/ai-profile" &
  ```

### 3. Verify Connection Health (`convo doctor`)
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

## 🛠️ The 4 Core Workflows

### 1. Ingest Architectural Specs & Invariants
Query the upstream conversation for specifications and state invariants:
```bash
convo ask --platform claude \
  "We are ready to implement Milestone 2. Provide the transition table, invariant list, and error codes we decided on during research."
```

### 2. Resolve Agent Doubts & Report Milestone Progress
Sync local agent findings and resolve technical forks directly with the upstream architect:
```bash
convo ask --platform chatgpt \
  "Milestone 1 is complete. During implementation of the lock service, we noticed potential contention under high write volume. Should we invalidate stale leases immediately or let the 180s TTL expire?"
```

### 3. Multi-Model Consensus & Arbitration (`convo compare`)
Broadcast proposals across multiple models in parallel with Stage 2 Technical Arbiter synthesis:
```bash
convo compare \
  "Evaluate trade-offs between distributed SQLite (Litestream/LiteFS) vs PostgreSQL for a multi-tenant event ledger. Identify single points of failure." \
  --platforms chatgpt,claude,deepseek,gemini \
  --arbitrate \
  --arbiter deepseek \
  --out-dir ./comparison-results
```

### 4. Search Past Architectural Decisions (`convo search`)
Search through all past turns and code blocks captured in the local **SQLite FTS5 ledger**:
```bash
convo search "JWT refresh token rotation invariants" --limit 5
```

---

## 🔌 IDE & Agent Integration (MCP in 30 Seconds)

ConvoLink includes an ephemeral, lightweight Model Context Protocol (MCP) server over `stdio` designed specifically for autonomous AI coding agents (Cursor, Windsurf, Claude Code, Antigravity).

### 1. One-Line Agent Setup
For **Claude Code**:
```bash
claude mcp add convolink -- bunx -y convolink@latest mcp
```

For **Cursor** (`.cursor/mcp.json`) or **Claude Desktop**:
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

*(You can also pass `--idle-timeout=10m` to customize ephemeral shutdown.)*

### 2. Autonomous 8-Tool Cognitive Suite
ConvoLink exposes an ergonomic, domain-partitioned tool suite optimized for high agent accuracy without context bloat:

| Tool | Autonomous Agent Role | Key Parameters |
|:---|:---|:---|
| `convo_ask` | Dispatch prompts to active web AI tab, stream responses, and auto-extract code artifacts (`// filepath:`). | `prompt`, `platform?`, `targetId?`, `think?`, `search?`, `extractArtifacts?` |
| `convo_compare` | Multi-model consensus: broadcast across models in parallel with Stage 2 Arbiter synthesis. | `prompt`, `platforms?`, `arbitrate?`, `arbiter?` |
| `convo_doctor` | Inspect connection health and open AI tabs. Auto-heals stale mutex locks when `fix: true`. | `fix?` |
| `convo_list_tabs` | Discover active AI tabs (ChatGPT, Claude, DeepSeek, Gemini) without window-focus theft. | *(none)* |
| `convo_tab` | Tab lifecycle management: open new chat, close tab, navigate back, or undo previous prompt. | `action: "new" \| "close" \| "back" \| "undo"`, `platform?`, `targetId?` |
| `convo_search` | Full-text search (SQLite FTS5) across past turns, decisions, and extracted code artifacts. | `query`, `limit?` |
| `convo_thread` | Thread management: export conversation history to Markdown/JSON, resume, or view checkpoints. | `action: "export" \| "resume" \| "history"`, `threadId?`, `targetId?`, `format?` |
| `convo_profile` | Multi-browser profile management: list discovered Chrome profiles or select active profile. | `action: "list" \| "select"`, `profileName?` |

---

## 🏗️ Architecture & Operational Safety

- 🎯 **Zero Window-Focus Theft:** Operates silently in the background via CDP lifecycle commands (`Page.setWebLifecycleState: active`). Your typing focus is never interrupted.
- 🔒 **PID-Aware `tmpfs` Mutex Locking:** Prevents prompt collisions across concurrent processes using lock files in `$XDG_RUNTIME_DIR/convolink/`. Dead process locks are automatically reclaimed.
- 🛡️ **Outbound Secret Scrubbing:** Automatically scrubs API keys (`sk-...`, `ghp_...`, AWS secrets, `.env` pairs) to `[REDACTED_SECRET]` before transmission.
- 🚪 **Safe Browser Detach:** ConvoLink **never** calls `browser.close()`. It disconnects cleanly, keeping your everyday tabs and logins intact.
- 🏛️ **Hexagonal Pure Domain Kernel:** `src/core/` contains **0 browser or network imports**, ensuring 100% testability with sub-millisecond in-memory doubles.

---

## 🧪 Testing & Verification

```bash
bun test          # Runs full 309-test suite across 59 test files (100% pass)
bun run typecheck # Strict TypeScript 7 typecheck (0 errors)
bun run build     # Compiles zero-dependency standalone dist bundles
```

---

## 📖 Complete Documentation & Architectural ADRs

Visit our official documentation site for complete architectural guides, ADR-001 through ADR-017, and Linux setup:  
👉 **[https://0xtanzim.github.io/convolink/](https://0xtanzim.github.io/convolink/)**

---

## 📄 License

MIT © 2026 Tanzim & ConvoLink Contributors.
