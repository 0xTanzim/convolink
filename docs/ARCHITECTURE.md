# ConvoLink System Architecture Specification

**Project:** ConvoLink (`convolink` / `convo`)  
**Paradigm:** Hexagonal Architecture (Ports and Adapters) with Strict Inversion of Control (IoC)  
**Target Environments:** Linux (Fedora/Ubuntu with `XDG` + `tmpfs`), macOS, Windows  
**Runtime:** TypeScript 7+ (Strict ESM), Bun runtime (`bun:sqlite`, `bun:test`)

---

## 1. High-Level Hexagonal Topology

```text
                  INBOUND ENTRYPOINTS (Driving Adapters)
       ┌──────────────────────────┬──────────────────────────┐
       │   MCP Server (stdio)     │      Smart CLI (`convo`) │
       │ (Claude / Cursor / Agents│ (ask, compare, export, etc)│
       └────────────┬─────────────┴─────────────┬────────────┘
                    │                           │
                    ▼                           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                       CONVOLINK PURE DOMAIN KERNEL                         │
│               (src/core/ — Pure TypeScript, Zero Browser Imports)          │
│                                                                            │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │ SessionOrchestrator  │  │   ComparisonEngine   │  │   PolicyService  │  │
│  │ • Target ID Pinning  │  │ • Staggered Dispatch │  │ • Secret Scrubber│  │
│  │ • Tab Auto-Provision │  │ • Consensus Arbiter  │  │ • Risk Tagger    │  │
│  │ • History Journal    │  │ • Metric Matrix      │  │                  │  │
│  └──────────┬───────────┘  └──────────┬───────────┘  └────────┬─────────┘  │
│             │                         │                       │            │
│  ┌──────────▼───────────┐  ┌──────────▼───────────┐  ┌────────▼─────────┐  │
│  │    ArtifactService   │  │    LockService       │  │   ThreadExport   │  │
│  │ • Directive Parser   │  │ • tmpfs Mutex        │  │ • Markdown / JSON│  │
│  │ • Multi-Chunk Stitch │  │ • Dead-PID Recovery  │  │   Serialization  │  │
│  └──────────────────────┘  └──────────────────────┘  └──────────────────┘  │
└─────────────┬─────────────────────────┬───────────────────────┬────────────┘
              │                         │                       │
              ▼ (PlatformPort)          ▼ (ThreadStore)         ▼ (BrowserPort)
┌─────────────────────────┐  ┌──────────────────────┐  ┌─────────────────────┐
│    PLATFORM DRIVERS     │  │   STORAGE ADAPTERS   │  │  BROWSER TRANSPORTS │
├─────────────────────────┤  ├──────────────────────┤  ├─────────────────────┤
│ • DeepSeekDriver        │  │ • SqliteLedgerAdapter│  │ • RawCdpAdapter     │
│ • ChatGPTDriver         │  │   ($XDG_DATA_HOME/   │  │ • FirefoxBidiAdapter│
│ • ClaudeDriver          │  │    ledger.sqlite)    │  │ • AgentBrowserAdapter
│ • GeminiDriver          │  │ • WorkspaceSinkAdapter│ │ (playwright pruned) │
│ • SettlingDetector      │  │                      │  │                     │
└─────────────────────────┘  └──────────────────────┘  └─────────────────────┘
```

---

## 2. Architectural Boundaries & Laws

### 2.1 The Zero-Import Isolation Law of `src/core/`
No file within `src/core/` may import any browser automation framework, WebSocket transport, or database library. This includes `playwright`, `puppeteer`, `ws`, `agent-browser`, and `bun:sqlite`. All interactions with infrastructure are inverted through Port interfaces in `src/core/ports/`:
- `BrowserPort`: Browser automation abstraction.
- `PlatformPort`: Web AI platform selector and DOM interaction abstraction.
- `ThreadStore`: Turn ledger and conversation persistence abstraction.
- `PolicyGatePort`: Outbound secret scrubbing and inbound risk tagging abstraction.

### 2.2 Strict File & Function Limits
- **Services / Core Modules:** Maximum 200 lines of code per file.
- **Handlers & Adapters:** Maximum 80 lines of code per function.
- **Cyclomatic Complexity:** Maximum nesting depth of 3 levels with mandatory early returns.

---

## 3. Core Subsystems & The Three Pillars

### 3.1 Pillar 1: Context Bridge Subsystems
- **Durable Turn Ledger (`src/adapters/storage/sqlite-ledger.adapter.ts`):** Implements `ThreadStore` backed by `bun:sqlite` in WAL mode with FTS5 BM25 search. Durably records symmetric conversation turns (user prompt at turn N, assistant response at N+1) at `$XDG_DATA_HOME/convolink/ledger.sqlite`.
- **Thread Serialization & Export (`src/core/services/thread-export.service.ts`):** Converts historical conversation threads and extracted code blocks into formatted Markdown or JSON context packets (`convo export <threadId>`).
- **Session Resumption:** Restores context and navigates browser tabs to active thread URLs via `convo resume <threadId>`.

### 3.2 Pillar 2: Intelligence Bridge Subsystems
- **Multi-Model Comparison Engine (`src/core/services/comparison-engine.ts`):** Dispatches parallel queries across ChatGPT, Claude, DeepSeek, and Gemini with staggered 250ms offsets to prevent CDP frame congestion. Uses `Promise.allSettled` for isolated failure domains.
- **Stage 2 Technical Arbiter (`src/core/services/comparison-coordinator.service.ts`):** Gathers candidate outputs and prompts an arbiter reasoning model (e.g. DeepSeek R1) to critique flaws and deliver a synthesized consensus solution (`convo compare --arbitrate`).
- **Asymmetric Delegation & Thinking Toggles:** Allows local agents to query frontier models via `convo ask` with `--think` and live web search grounding.

### 3.3 Pillar 3: Capability Bridge Subsystems
- **Session Orchestrator (`src/core/services/orchestrator.ts`):** Central coordinator handling tab discovery (`TabResolver`), mutual exclusion (`LockService`), outbound security sanitization (`PolicyService`), prompt submission, and stream continuation loops.
- **3-Signal Streaming Settling (`src/adapters/platforms/settling-detector.ts`):** Ensures complete responses by conjoining:
  1. Action container state (stop button / loading spinner absent).
  2. Thinking container transition (collapsible details closed / static).
  3. Quiescence window: zero DOM mutations or length changes for >= 400ms.
- **Artifact Extraction & Storage Sink (`src/core/services/artifact.service.ts` & `src/adapters/storage/workspace-sink.adapter.ts`):** Parses `// filepath:` directives and persists multi-file code trees directly to the workspace with path-traversal containment.
- **PID-Aware `tmpfs` Mutex Locking (`src/core/services/lock.service.ts`):** Enforces single-agent access to tabs with 180s TTL, active heartbeat lease renewal, and automatic reclamation of stale dead-PID locks with console warnings.

### 3.4 Inbound Entrypoints
- **CLI (`src/entrypoints/cli.ts`):** High-speed terminal commands (`doctor`, `list`, `ask`, `compare`, `tab`, `back`, `undo`, `history`, `resume`, `export`, `search`, `mcp`).
- **MCP Server (`src/entrypoints/mcp.server.ts`):** Standard JSON-RPC 2.0 stdio server exposing 8 tools: `convo_ask`, `convo_compare`, `convo_list_tabs`, `convo_tab_new`, `convo_tab_close`, `convo_undo`, `convo_search`, and `convo_export`.
