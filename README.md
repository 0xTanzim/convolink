# ConvoLink (`convolink` / `convo`)

> **Autonomous Neural Bridge Linking Upstream Web AI Knowledge to Local Coding Agents**  
> *Connect local coding agents (Cursor, Claude Code, Antigravity) directly to your live, research-heavy web sessions in ChatGPT, Claude, DeepSeek, and Gemini. Stream architectural guidance, specifications, and project context directly to your editor, report progress upstream, and cross-validate critical decisions across multiple models at zero token cost.*

[![Runtime](https://img.shields.io/badge/Runtime-Bun%20%3E%3D1.2-black?logo=bun)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-v7.0%20Strict%20ESM-blue?logo=typescript)](https://www.typescriptlang.org)
[![Tests](https://img.shields.io/badge/Tests-137%20passing%20(bun:test)-success)](https://bun.sh)
[![Architecture](https://img.shields.io/badge/Architecture-Hexagonal%20Ports%20%26%20Adapters-orange)](#-architecture)
[![License](https://img.shields.io/badge/License-MIT-green)](#-license)

---

## ⚡ The Problem: The Context & Intent Bottleneck (The Human Relay Trap)

In modern software engineering, autonomous coding models (such as **Claude Opus 5.5 / Sonnet 5.5**, **Gemini 4 Carbon / Argon**, **OpenAI GPT-6.1 Sol / Astra**, and **DeepSeek V4.1 Flash / R1**) possess world-class reasoning and implementation capabilities—topping benchmarks like the [Artificial Analysis Engineering Index](https://artificialanalysis.ai/indexes/engineering) and FrontierCode. **Generating raw code syntax is no longer the developer's primary bottleneck.**

**The true bottleneck is Architectural Context, Specifications, Flow, and Doubt Resolution:**

1. **The Upstream R&D Reservoir:**  
   You spend hours or days in web AI chats conducting deep research, analyzing requirements, modeling edge cases, designing database schemas, and formulating system specifications. That web conversation thread becomes the **living project architect and knowledge base**—holding the full mental model of *why* decisions were made.
2. **The Local Agent Amnesia:**  
   When you switch to your IDE or terminal to execute with an autonomous agent (**Cursor**, **Claude Code**, **Antigravity**, **Windsurf**), that agent starts with **zero connection to the upstream R&D**. It has no idea what trade-offs were chosen, what invariants must be maintained, or what the overall masterplan looks like.
3. **The "Human Relay" Bottleneck:**  
   The developer is trapped acting as an exhausted **human context courier**:
   - The local agent finishes a task, hits an ambiguous design boundary, or has a doubt: *"Which caching strategy did we agree on? What is the expected event schema for Step 3?"*
   - The developer copies the agent's progress, confusion, or doubt into the web chat.
   - The upstream web AI (which holds the whole masterplan) thinks, reviews the project history, and outputs the architectural guidance, flow instructions, and specifications.
   - The developer copies those specs back to the local agent so it knows what to build.
   - When the local agent finishes a milestone, the developer manually summarizes the progress back to the upstream chat to keep the brain updated.
   - If the developer steps away or fails to relay the doubt, the local agent makes assumptions, drifts from the architecture, and writes conflicting code.

```mermaid
flowchart TD
    subgraph Problem ["The Broken Workflow: Developer as Human Context Courier"]
        UpstreamAI["Upstream Web AI (ChatGPT / Claude / DeepSeek / Gemini)<br/>Holds days of R&D, architecture decisions, trade-offs & masterplan"]
        HumanRelay["Developer (Manual Human Relay)<br/>• Copies local agent doubts & progress to browser<br/>• Waits for web AI to formulate next spec & flow<br/>• Copies architectural guidance back to IDE"]
        LocalAgent["Downstream Coding Agent (Cursor / Claude Code / Antigravity)<br/>Generates code, but lacks context, gets confused, and drifts off architecture"]

        UpstreamAI <-->|"Manual Copy / Paste of Specs & Flow"| HumanRelay <-->|"Manual Copy / Paste of Progress & Doubts"| LocalAgent
    end
```

```mermaid
flowchart TD
    subgraph Solution ["The ConvoLink Solution: Autonomous Upstream-Downstream Neural Link"]
        UpstreamSession["Upstream Web AI Knowledge Base<br/>(Live ChatGPT, Claude, DeepSeek, Gemini Tabs)"]
        ConvoLink["ConvoLink Bridge & MCP Server<br/>• Autonomous context, spec & flow retrieval<br/>• Bidirectional doubt resolution & progress reporting<br/>• Zero-cost multi-model consensus validation<br/>• SQLite FTS5 conversation ledger"]
        LocalIDEAgent["Downstream Coding Agent & IDE<br/>(Cursor, Claude Code, Antigravity, Shell)"]

        UpstreamSession <-->|"Real-Time Architectural Guidance & Progress Sync"| ConvoLink <-->|"Native MCP Tools & Context Streaming"| LocalIDEAgent
    end
```

**ConvoLink solves this permanently.** It turns your open, authenticated browser tabs into an active, two-way architectural guidance oracle for your local AI coding agents.

---

## 🌟 Core Superpowers

### 1. 🧠 Upstream Brain Link: Direct Specs, Architecture & Doubt Resolution
Your local coding agent can directly query your upstream browser conversation to retrieve specifications, clarify design invariants, or ask: *"I am implementing Step 2 and hit an ambiguous boundary between the auth service and session store. What was our agreed architecture?"* The upstream model answers with full context of prior R&D, guiding the local agent accurately without human intervention.

### 2. ⚖️ Zero-Cost Multi-Model Consensus Validation (`convo compare`)
When facing a high-stakes architectural fork, concurrency design, or security-sensitive refactor, your agent can broadcast the decision across **ChatGPT, Claude, DeepSeek, and Gemini simultaneously** at zero API token cost. It acts as an instant **Multi-Model Engineering Council**:
- Compares design proposals and trade-offs side by side.
- Synthesizes consensus via a designated Technical Arbiter (e.g. DeepSeek R1).
- Detects architectural violations and hallucinations before writing a single line of code.

### 3. 🔄 Autonomous Progress Sync & Stream Continuation
When local agents complete milestones or generate large outputs, ConvoLink keeps the upstream session synchronized and automatically stitches multi-chunk truncated responses (e.g. "Continue generating" buttons) seamlessly up to 5 iterations.

### 4. 🔍 Instant Full-Text Conversation Search (`convo search`)
All conversation turns, architectural decisions, and code snippets are automatically indexed into a local, high-performance **SQLite FTS5 ledger** with WAL mode. Your agent can instantly search across all past discussions to recall why a specific decision was made:
```bash
convo search "JWT refresh token rotation invariants"
```

### 5. 📁 Zero-Touch Multi-File Extraction (`-w`)
When the upstream architect outputs concrete implementation files tagged with `// filepath: src/auth.ts`, ConvoLink automatically parses the directives, creates parent directories recursively, sanitizes path traversal attacks, and writes the source files directly to your workspace.

### 6. 🔌 Turnkey Model Context Protocol (MCP) Server (`convo mcp`)
Connect ConvoLink to **Cursor**, **Claude Desktop**, **Antigravity**, or any MCP-compliant agent in 30 seconds. Your agent gains native cognitive tools to list open AI tabs, query active discussions, compare multiple models, and search conversation history.

---

## 🚀 30-Second Quickstart

### Prerequisites
- **[Bun](https://bun.sh)** (`>= 1.2.0`)
- **Google Chrome** (or Chromium / Brave)

### 1. Clone & Install
```bash
git clone https://github.com/0xTanzim/convolink.git
cd convolink
bun install
bun link # Optional: makes `convo` and `convolink` globally accessible
```

### 2. Launch Chrome with Remote Debugging
Launch Chrome with remote debugging enabled on port `9222`:

```bash
# On Linux (Fedora / Ubuntu / Debian):
./scripts/fedora-chrome-debug.sh

# Or on macOS:
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222 &

# Or on Windows (PowerShell):
Start-Process "chrome.exe" -ArgumentList "--remote-debugging-port=9222"
```

> **Note:** Open your favorite AI platforms ([ChatGPT](https://chatgpt.com), [Claude](https://claude.ai), [DeepSeek](https://chat.deepseek.com), [Gemini](https://gemini.google.com)) in tabs and log in.

### 3. Verify Health (`convo doctor`)
Check CDP transport connectivity and detect your open AI tabs:

```bash
convo doctor
```

```text
🔍 Running ConvoLink Doctor...

[CDP Transport] Status: ONLINE (Latency: 1ms)
[Tabs] Found 4 total open tab(s), 4 supported AI tab(s).

• [CHATGPT] Architecture Discussion - ChatGPT
  TargetId: A16BE3AD1A2B8238DE0B27ECA73F9580 | ✅ READY | 🔓 UNLOCKED
  URL: https://chatgpt.com/c/6ae56dbc-63fc-83ec-bc20-00b69ce6cc33

• [CLAUDE] Concurrency Refactoring - Claude
  TargetId: 44F12A9E58BC478E916BA1283B927CE1 | ✅ READY | 🔓 UNLOCKED
  URL: https://claude.ai/chat/5b7f14b2-e981-4322-a7d2-7c3905581bf4

• [DEEPSEEK] Algorithmic Optimization - DeepSeek
  TargetId: 713AD61E2ACB2C39A39AE3EE887A30E3 | ✅ READY | 🔓 UNLOCKED
  URL: https://chat.deepseek.com/a/chat/s/b36a98cc-7205-4cde-a1a0-cfc6c98f35c8

• [GEMINI] Cloud Deployment Strategy - Gemini
  TargetId: 837BDC4DF3585EA32B8AE2EE261C24BA | ✅ READY | 🔓 UNLOCKED
  URL: https://gemini.google.com/app/e2bdddb2fd90b84a
```

---

## 🛠️ Common Workflows & Examples

### 1. Ingest Upstream Architectural Specifications
When the local coding agent is ready to start a new phase, it queries the upstream project conversation for the agreed design specifications, data models, and flow invariants:
```bash
convo ask --platform claude \
  "We are ready to implement Milestone 2 (State Machine & Event Sourcing). Please provide the exact transition table, invariant list, and error codes we decided on during research."
```

### 2. Resolve Agent Doubts & Report Progress (Bidirectional Sync)
When the local agent finishes a task or encounters an architectural ambiguity, it syncs its state and requests direction directly from the upstream brain:
```bash
convo ask --platform chatgpt \
  "Milestone 1 is complete and all unit tests pass. During implementation of the lock service, we noticed potential contention under high write volume. Should we invalidate stale leases immediately or let the 180s TTL expire? What was our architectural consensus?"
```

### 3. Multi-Model Engineering Council & Validation (`convo compare`)
Before executing a high-risk or irreversible architectural change, broadcast the proposal across multiple frontier models (**Claude, ChatGPT, DeepSeek, Gemini**) in parallel. Use `--arbitrate` to have an Arbiter synthesize the consensus:
```bash
convo compare \
  "Evaluate trade-offs between distributed SQLite (Litestream/LiteFS) vs PostgreSQL for a multi-tenant event ledger under high write concurrency. Identify edge cases, single points of failure, and write amplification risks." \
  --platforms chatgpt,claude,deepseek,gemini \
  --arbitrate \
  --arbiter deepseek \
  --out-dir ./comparison-results
```

### 4. Search Past R&D Decisions in Local Ledger (`convo search`)
Recall why a specific technical trade-off was made days ago across any open browser chat:
```bash
convo search "SQLite WAL mode busy_timeout pragma" --limit 5
```

### 5. Write Generated Implementation Files Directly to Workspace (`-w`)
When the upstream model generates production code tagged with `// filepath:` directives, extract them directly into your file tree:
```bash
convo ask --platform claude \
  "Provide the implementation for the ring buffer according to our spec. Use // filepath: src/ring-buffer.ts and // filepath: tests/ring-buffer.test.ts" \
  -w --out-dir .
```

### 6. Reset Conversation or Spawn Background Tabs
Start a fresh conversation thread, or spawn a clean tab in the background without stealing OS focus:
```bash
# Reset active tab to a new conversation
convo ask --platform deepseek "Let's begin a new architecture spike" --new

# Or spawn a new background tab
convo tab new claude
```

---

## 🔌 IDE & Agent Integration

### Model Context Protocol (MCP) Setup

ConvoLink includes a native JSON-RPC 2.0 MCP server over `stdio`. It exposes tools (`convo_ask`, `convo_compare`, `convo_search`, `convo_list_tabs`, `convo_export`, `convo_tab_new`, `convo_undo`) directly to modern AI agents.

#### Claude Desktop
Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `~/.config/Claude/claude_desktop_config.json` (Linux):
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

#### Cursor IDE
Add to `.cursor/mcp.json` in your project or global user settings:
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

### Agentic Skills Standard (`npx skills add`)
ConvoLink complies with the open [AgenticSkills.io](https://agenticskills.io) standard (`SKILL.md`). Install it into any agent workspace with one command:
```bash
# Install into project agent directory (.claude/skills, .agents/skills, etc.)
npx skills add 0xTanzim/convolink

# Or install globally across all coding agent sessions
npx skills add -g 0xTanzim/convolink
```

Supported environments include **Claude Code**, **Antigravity / Gemini CLI**, **Cursor**, **GitHub Copilot CLI**, **Windsurf**, and custom LLM orchestrators.

---

## 💻 CLI Command Reference

| Command | Description |
| :--- | :--- |
| `doctor [--launch]` | Verifies CDP connection health, tests protocol latency, and audits open AI tabs. |
| `list` | Lists all active browser tabs matching supported AI platforms. |
| `ask <prompt>` | Sends a prompt to a specific AI tab, streams completion, and outputs the response. |
| `compare <prompt>` | Broadcasts prompt across multiple models in parallel with optional Arbiter consensus. |
| `search <query>` | Performs SQLite FTS5 full-text search across past conversation turns and code snippets. |
| `export <threadId>` | Exports a conversation thread and extracted code blocks as Markdown or JSON. |
| `resume <threadId>` | Restores a session by navigating the browser to the saved conversation URL. |
| `mcp` | Runs the Model Context Protocol (MCP) server over `stdio` for agent IDEs. |
| `tab new <platform>` | Spawns a new background tab for `chatgpt`, `claude`, `deepseek`, or `gemini`. |
| `tab close <targetId>` | Closes a specific browser tab cleanly. |
| `back [targetId]` | Navigates the tab backward in browser history. |
| `undo [targetId]` | Restores the prior thread URL from the pre-mutation checkpoint journal. |
| `history [targetId]` | Displays recent session checkpoints and thread navigation history. |

### `convo ask` Flags
- `-p, --platform <name>`: Target platform (`chatgpt`, `claude`, `deepseek`, `gemini`). Default: first ready tab.
- `-t, --targetId <hex>`: Target a specific browser tab by CDP ID.
- `-n, --new`: Reset active conversation to a fresh session before submitting.
- `--open-tab`: Spawn a brand-new tab in the background before submitting.
- `-w, --write-files`: Automatically extract code blocks and write them to disk.
- `-o, --out-dir <path>`: Destination directory for extracted files (default: `./artifacts`).
- `--think`: Enable reasoning / deep-thinking mode (e.g. DeepSeek R1).
- `--no-continue`: Disable automated multi-chunk continuation.
- `--timeout <ms>`: Request timeout in milliseconds (default: `120000`).
- `--transport <name>`: Transport engine: `raw-cdp` (default), `playwright`, `agent-browser`, or `firefox-bidi`.

### `convo compare` Flags
- `--platforms <p1,p2>`: Comma-separated list of platforms (default: `chatgpt,claude,deepseek,gemini`).
- `--arbitrate`: Trigger Stage 2 Technical Arbiter consensus synthesis.
- `--arbiter <platform>`: Designate Arbiter judge (default: `deepseek`).
- `--mode <parallel|sequential>`: Execution schedule (default: `parallel` with staggered 250ms dispatch).
- `--out-dir <path>`: Directory to persist `REPORT.md` and extracted code artifacts.
- `--timeout <ms>`: Timeout per model execution (default: `120000`).

---

## 🏗️ Architecture

ConvoLink is engineered following **Hexagonal Architecture (Ports and Adapters)** with strict Inversion of Control (IoC).

```mermaid
flowchart TD
    subgraph Inbound ["Inbound Entrypoints"]
        CLI["CLI (bin/convo.ts, bin/convolink.ts)"]
        MCP["MCP Server (bin/convolink-mcp.ts stdio)"]
        Skills["Agent Skills (skills/convolink/SKILL.md)"]
    end

    subgraph Core ["Pure Domain Kernel (src/core/) — Zero Browser Imports"]
        Orchestrator["SessionOrchestrator"]
        ComparisonEngine["ComparisonEngine & ArbiterPromptBuilder"]
        LockService["LockService (tmpfs PID-Aware Mutex)"]
        PolicyService["PolicyService (Secret Scrubbing)"]
        ArtifactService["ArtifactService (Directive Parser)"]
        ThreadExport["ThreadExportService"]
    end

    subgraph Ports ["Abstract Port Contracts (src/core/ports/)"]
        BrowserPort["BrowserPort"]
        PlatformPort["PlatformPort"]
        ThreadStore["ThreadStore"]
    end

    subgraph Outbound ["Outbound Infrastructure Adapters (src/adapters/)"]
        subgraph Transports ["Browser Transports"]
            CDP["RawCdpAdapter (:9222 Native WebSocket)"]
            PW["PlaywrightAdapter (connectOverCDP)"]
            BiDi["FirefoxBidiAdapter (W3C WebDriver BiDi)"]
            AB["AgentBrowserAdapter (agent-browser CLI)"]
        end
        subgraph Drivers ["Platform DOM Drivers"]
            ChatGPTDriver["ChatGPTDriver (ProseMirror & CodeMirror)"]
            ClaudeDriver["ClaudeDriver (ProseMirror DOM)"]
            DeepSeekDriver["DeepSeekDriver (Vue Microtasks & R1)"]
            GeminiDriver["GeminiDriver (Quill DOM & Markdown)"]
        end
        subgraph Storage ["Durable Persistence"]
            SqliteLedger["SqliteLedgerAdapter (bun:sqlite WAL & FTS5)"]
        end
    end

    Inbound --> Core
    Core --> Ports
    Ports --> Outbound
```

### Architectural Guarantees (`AGENTS.md`)
1. **The Zero-Import Isolation Law of `src/core/`:** No file within `src/core/` is permitted to import any browser automation framework, WebSocket library, or network driver. Domain logic remains 100% decoupled and unit-testable.
2. **Strict File Size Limits:** Max **200 lines per file** and **80 lines per function** across core services to eliminate God-components and maintain high readability.
3. **100% Test-First Provenance:** Every domain service, adapter, and CLI command is backed by automated tests.

---

## 🛡️ Enterprise & Operational Safety

- 🎯 **Zero Window-Focus Theft:** Interacts silently via background CDP lifecycle commands (`Page.setWebLifecycleState: active`) and focus emulation. Your typing and OS window focus are never interrupted.
- 🔒 **PID-Aware `tmpfs` Mutex Locking:** Prevents prompt collisions across concurrent processes using lock files in `$XDG_RUNTIME_DIR/convolink/` (RAM-backed `tmpfs`). Stale locks from dead processes (`process.kill(pid, 0)`) or expired heartbeats are automatically reclaimed.
- 🛡️ **Non-Blocking Secret Scrubbing:** Every outbound prompt is automatically scanned. Sensitive tokens matching OpenAI keys (`sk-...`), GitHub PATs (`ghp_...`), AWS secrets, and `.env` variable assignments are redacted to `[REDACTED_SECRET]` before leaving your machine.
- 🚪 **Safe Detach Semantics:** ConvoLink **never** calls `browser.close()`. It attaches to existing browser sessions and cleanly disconnects its WebSocket client upon completion. Your browser, open tabs, cookies, and active sessions remain untouched.
- 🌐 **100% Local Execution:** Communicates solely via local loopback (`127.0.0.1:9222`). Zero prompt data or code is ever sent to third-party telemetry servers.

---

## 🧪 Testing & Verification

ConvoLink is verified with `bun:test` across unit, integration, and end-to-end suites using in-memory test doubles (`FakeBrowserPort`, `FakeThreadStore`):

```bash
# Run all automated tests
bun test

# Run unit tests only
bun run test:unit

# Run strict TypeScript 7 typecheck
bun run typecheck
```

```text
bun test v1.4.4
 137 pass
 0 fail
 430 expect() calls
Ran 137 tests across 32 files. [1455.00ms]

$ tsc --noEmit
(0 errors)
```

---

## 📄 License

MIT © 2026 Tanzim & ConvoLink Contributors.
