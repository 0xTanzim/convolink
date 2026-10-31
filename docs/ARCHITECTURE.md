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
│ • GeminiDriver          │  │    ledger.sqlite)    │  │ • PlaywrightAdapter │
│                         │  │ • WorkspaceSink      │  │ • AgentBrowserAdapter
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

## 3. Core Subsystems

### 3.1 Session Orchestrator (`src/core/services/orchestrator.ts`)
The central coordinator that:
1. Detects available platform tabs via `TabResolver`.
2. Acquires tab mutex locks via `LockService`.
3. Auto-provisions background tabs if requested via `TabManagerService`.
4. Sanitizes outbound prompts via `PolicyService`.
5. Dispatches execution to the corresponding `PlatformDriver`.
6. Handles multi-chunk stream continuations and artifact extraction.
7. Persists completed turns to `ThreadStore`.
8. Safely detaches session handles without terminating user tabs.

### 3.2 Multi-Model Comparison & Technical Arbiter (`src/core/services/comparison-engine.ts`)
- **Staggered Dispatch:** Dispatches parallel queries with a 250ms offset to avoid CDP frame saturation.
- **Failure Domain Isolation:** Wraps individual queries in `Promise.allSettled`, allowing healthy models to finish even if one times out or triggers a CAPTCHA.
- **Stage 2 Technical Arbiter:** Gathers candidate outputs and prompts an arbiter reasoning model (e.g. DeepSeek R1) to critique flaws and deliver a synthesized consensus solution.

### 3.3 Storage Subsystem (`src/adapters/storage/sqlite-ledger.adapter.ts`)
- Implements `ThreadStore` backed by `bun:sqlite`.
- Stores immutable turns, extracted code blocks, and context packets in `$XDG_DATA_HOME/convolink/ledger.sqlite`.
- Enables CLI `convo export` and `convo resume`.

### 3.4 Inbound Entrypoints
- **CLI (`src/entrypoints/cli.ts`):** High-speed terminal commands (`ask`, `compare`, `doctor`, `export`, `resume`, `undo`, `tab`, `mcp`).
- **MCP Server (`src/entrypoints/mcp.server.ts`):** Standard JSON-RPC 2.0 stdio server exposing `convo_ask`, `convo_compare`, `convo_list_tabs`, `convo_tab_new`, `convo_tab_close`, and `convo_undo`.
