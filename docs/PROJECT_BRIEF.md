# ConvoLink Project Brief

## 1. Executive Summary

**Project Name:** ConvoLink (`convolink` / `convo`)  
**Product Category:** Cognitive Continuity Runtime & Cross-Browser AI Orchestration  
**Primary Users:** Software Engineers, Autonomous Coding Agents (Claude Code, Cursor, Antigravity, OpenCode)

---

## 2. Problem Statement: The "Dual-Brain Amnesia" Gap

Software engineers routinely conduct deep architectural explorations, debugging sessions, and trade-off analyses using authenticated web AI interfaces (ChatGPT Plus/Pro, DeepSeek, Google Gemini Advanced, Claude Pro). These web sessions represent hours of refined context, extensive reasoning, and unmetered compute.

However, when an engineer transitions to their local terminal to execute changes, their autonomous coding agent operates with total amnesia. The developer is reduced to a manual clipboard—copying plans from the browser to the terminal and pasting compile errors back into the browser.

Existing automation tools fall short because they:
- Launch ephemeral, logged-out browser instances with separate profiles.
- Destroy code indentation and formatting through naive text scraping.
- Terminate during long silent thinking intervals in reasoning models.
- Steal OS desktop focus with jarring `bringToFront()` calls.
- Require high-cost metered API tokens for models the user already pays subscriptions for.

---

## 3. Product Vision & The Three Pillars

ConvoLink transforms authenticated browser tabs into an active, stateful intelligence layer for local workflows through Three Core Pillars:

### 3.1 Pillar 1: Context Bridge
1. **Durable Local Ledger:** Persists conversation turns, extracted code blocks, and context packets in a local SQLite database (`bun:sqlite` with WAL mode and FTS5 search) for instant resumption and documentation export.
2. **Symmetric Turn Capture:** Records user prompt turns alongside assistant responses to ensure faithful transcript recreation and cache-stable context packets (`.convo/CONTEXT.md`).
3. **Session Continuity & Portability:** Enables instant thread export (`convo export`) and browser session resumption (`convo resume`) across restarts.

### 3.2 Pillar 2: Intelligence Bridge
4. **Direct Session Connection:** Connects via Chrome DevTools Protocol (CDP) or W3C WebDriver BiDi to the developer's live browser tabs without spawning new profiles or stealing window focus.
5. **Multi-Model Comparison & Arbitration:** Broadcasts prompts simultaneously across ChatGPT, Claude, DeepSeek, and Gemini, benchmarks response latency and code volume, and synthesizes a unified consensus solution via a Technical Arbiter (`convo compare --arbitrate`).
6. **Asymmetric Intelligence Delegation:** Allows cost-effective local agents to borrow upstream reasoning (DeepSeek v4.1 Flash, GPT-6 Asta, Claude Opus 5.5) and live web search grounding on demand.

### 3.3 Pillar 3: Capability Bridge
7. **Automated Multi-File Artifact Extraction:** Automatically parses `// filepath:` directives and writes structured code files directly to the local filesystem with path-traversal protection.
8. **Autonomous Stream Continuation:** Clicks "Continue generating" and stitches multi-chunk stream completions seamlessly without human intervention.
9. **Non-Blocking Security Gating:** Scrubs outbound secrets (API keys, JWTs, AWS credentials, `.env` variables) and tags destructive inbound shell commands without deadlocking agent `stdio`.
10. **Zero Window-Focus Theft & tmpfs Mutexes:** Uses background CDP lifecycle commands and RAM-backed mutex locks (`$XDG_RUNTIME_DIR/convolink/`) to guarantee developer desktop focus is never interrupted.
