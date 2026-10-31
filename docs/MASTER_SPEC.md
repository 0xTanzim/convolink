# CONVOLINK: Continuity Runtime & Cross-Browser AI Architecture
**Document Type:** Master System Specification, Project Brief & Architecture Decision Records (ADRs)
**Target Environment:** Fedora Linux First (`XDG` / `tmpfs` native), Cross-Platform Ready (macOS / Windows)
**Runtime Stack:** TypeScript (Strict ESM on Bun / Node.js), Optional Rust Native Extensions, Minimal POSIX Shell Bootstrapper

---

## Part 1: Project Brief & Vision (`PROJECT_BRIEF.md`)

### 1.1 The Problem Statement: The "Dual-Brain Amnesia" Gap
Modern software engineering happens across two isolated surfaces:
1. **The Web Brain Surface (ChatGPT, DeepSeek, Gemini, Claude):** Where engineers spend hours doing deep R&D, debating system trade-offs, exploring edge cases, and running long-horizon reasoning (`DeepThink` / `o-series` / `Gemini Thinking`) with zero per-token API cost.
2. **The Local Executor Surface (Claude Code, Antigravity, OpenCode, Codex):** Where autonomous CLI coding agents inspect local files, run compilers, and edit repositories.

**The Disconnect:** When an engineer moves from a 2-hour browser R&D session to their terminal, the local CLI coding agent starts with **total amnesia**. The human is forced to act as a manual clipboard—copying architecture specs from the browser, pasting them into the CLI, copying terminal stack traces, and pasting them back into the browser.

Existing open-source tools fail to solve this because they are built as brittle "prompt senders" that either:
- Spawn isolated, logged-out Chrome profiles that cannot see the user's real browser tabs.
- Destroy code block indentation through naive `.innerText` scraping.
- Cut off reasoning models prematurely during silent thinking pauses.
- Steal OS window focus (`bringToFront()`) every time a background query runs.
- Dump raw 50-turn chat transcripts into the CLI agent, polluting its context window and burning tokens.

### 1.2 The Solution: A Cognitive Continuity Runtime
**`convolink`** is not a simple scraper or API wrapper. It is a **local-first Continuity Runtime** built on **Hexagonal Architecture (Ports & Adapters)** with strict **Dependency Injection (DI)** across Three Core Pillars: Context Bridge, Intelligence Bridge, and Capability Bridge.

It connects directly to the developer's already-running browser (`ws://127.0.0.1:9222`), treats live web chat tabs as stateful architectural producers, distills raw discussions into deterministic, SHA-256 fingerprinted **Context Packets** (`.convo/CONTEXT.md`), and exposes a unified CLI and Model Context Protocol (MCP) surface so local coding agents (Antigravity, Claude Code, OpenCode) can inherit web R&D history and consult live browser tabs with zero manual copy-pasting.

### 1.3 Core Engineering Goals
1. **Zero-Coupling Core Kernel:** `src/core/` never imports `playwright`, `ws`, `puppeteer`, or any browser library. All browser transports (`RawCdpAdapter`, `FirefoxBidiAdapter`, `AgentBrowserAdapter`) and AI platforms (`DeepSeekDriver`, `ChatGPTDriver`, `ClaudeDriver`, `GeminiDriver`) are hot-swappable plugins behind strict TypeScript interfaces.
2. **Symbiosis with Live Browser Sessions:** Attaches to the user's real, authenticated Chrome/Brave/Chromium/Firefox tabs without spawning duplicate browser windows or calling `browser.close()`.
3. **Zero Window-Focus Theft:** Executes background tab interactions using CDP lifecycle emulation (`Page.setWebLifecycleState` & `Emulation.setFocusEmulationEnabled`) so the user's terminal and cursor are never interrupted.
4. **100% Code Indentation Fidelity:** Bypasses brittle `.innerText` space collapse by cloning DOM containers, stripping UI chrome (`Copy` buttons, SVGs, toolbars), and extracting `<pre><code>` blocks via `.textContent`.
5. **Multi-Signal Stream Completion:** Prevents premature cutoff during `DeepThink` / reasoning pauses by conjoining UI spinner states, thinking-block transitions, turn fingerprinting, and DOM quiescence inside a single in-page observer promise.
6. **Deterministic Context Compilation:** Compiles multi-turn web discussions into a compact, cache-stable `.convo/CONTEXT.md` artifact containing active invariants, settled decisions, discarded approaches, canonical code interfaces, and immediate directives.

---

## Part 2: System Architecture Specification (`ARCHITECTURE.md`)

### 2.1 High-Level Hexagonal Topology (Ports & Adapters)

```text
                  INBOUND DRIVING SURFACES (Entrypoints)
       ┌──────────────────────────┬──────────────────────────┐
       │    MCP Server (stdio)    │     Smart CLI (`convo`)  │
       │ (Antigravity/Claude Code)│ (doctor, sync, ask, tabs)│
       └────────────┬─────────────┴─────────────┬────────────┘
                    │                           │
                    ▼                           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                       CONVOLINK CONTINUITY KERNEL                          │
│                 (src/core/ — Pure TypeScript, Zero Imports)                │
│                                                                            │
│  ┌──────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │  SessionOrchestrator │  │   ContextCompiler    │  │    PolicyGate    │  │
│  │ • Fuzzy Tab Matcher  │  │ • Structural AST Fold│  │ • Secret Redactor│  │
│  │ • Target ID Pinning  │  │ • Interface Extractor│  │ • Non-Blocking   │  │
│  │ • Per-Tab Mutex Lock │  │ • SHA-256 Fingerprint│  │   Risk Tagger    │  │
│  │ • Turn Fingerprinting│  │ • Packet Diff Engine │  │ • Size Bundler   │  │
│  └──────────┬───────────┘  └──────────┬───────────┘  └────────┬─────────┘  │
└─────────────┼─────────────────────────┼───────────────────────┼────────────┘
              │                         │                       │
              ▼ (Port: PlatformPort)    ▼ (Port: ThreadStore)   ▼ (Port: BrowserPort)
┌─────────────────────────┐  ┌──────────────────────┐  ┌─────────────────────┐
│    PLATFORM DRIVERS     │  │   STORAGE ADAPTERS   │  │  BROWSER TRANSPORTS │
├─────────────────────────┤  ├──────────────────────┤  ├─────────────────────┤
│ • DeepSeekDriver        │  │ • SqliteLedgerStore  │  │ • RawCdpAdapter     │
│ • ChatGPTDriver         │  │   (Immutable turns)  │  │ • FirefoxBidiAdapter│
│ • ClaudeDriver          │  │ • WorkspaceSink      │  │ • AgentBrowserCli   │
│ • GeminiDriver          │  │   (.convo/CONTEXT.md)│  │                     │
└─────────────────────────┘  └──────────────────────┘  └─────────────────────┘
```

### 2.2 Target Repository Directory Structure

```text
convolink/
├── docs/
│   ├── PROJECT_BRIEF.md               # Vision, problem statement, and goals
│   ├── ARCHITECTURE.md                # System topology, ports, and data flows
│   └── ADR.md                         # Architecture Decision Records (ADR-001 to ADR-016)
├── scripts/
│   └── fedora-chrome-debug.sh         # POSIX helper to verify/launch Chrome on 127.0.0.1:9222
├── src/
│   ├── core/                          # PURE DOMAIN KERNEL (Zero external browser imports)
│   │   ├── env/
│   │   │   └── host-env.ts            # Cross-platform path resolver (Fedora XDG/tmpfs first)
│   │   ├── ports/
│   │   │   ├── browser.port.ts        # BrowserPort interface (attach, evaluate, fill, etc.)
│   │   │   ├── platform.port.ts       # PlatformPort interface (readThread, submit, toggles)
│   │   │   ├── storage.port.ts        # ThreadStore & WorkspaceSinkPort interfaces
│   │   │   ├── compiler.port.ts       # ContextCompiler & ContextPacket contracts
│   │   │   └── policy.port.ts         # PolicyGate secret scrubbing & risk tagging contract
│   │   ├── services/
│   │   │   ├── orchestrator.ts        # Main use-case coordinator (doctor, ask, compare, etc.)
│   │   │   ├── comparison-engine.ts   # Multi-model benchmarking and arbitration
│   │   │   ├── lock.service.ts        # Per-tab mutex lock manager ($XDG_RUNTIME_DIR/convolink)
│   │   │   └── policy.service.ts      # Secret redaction (.env, API keys) & shell classification
│   │   └── errors/
│   │       └── bridge-errors.ts       # Structured error taxonomy (Auth, RateLimit, Timeout)
│   ├── adapters/                      # SWAPPABLE INFRASTRUCTURE PLUGINS
│   │   ├── browsers/
│   │   │   ├── raw-cdp.adapter.ts     # Direct WebSocket CDP client (per-tab target pinning)
│   │   │   ├── firefox-bidi.adapter.ts # W3C WebDriver BiDi client
│   │   │   └── agent-browser.adapter.ts # CLI wrapper around `agent-browser --cdp 9222`
│   │   ├── platforms/
│   │   │   ├── chatgpt.driver.ts      # Multi-layout fallback chain, ProseMirror input
│   │   │   ├── claude.driver.ts       # Claude ProseMirror DOM extractor and streaming handler
│   │   │   ├── deepseek.driver.ts     # DeepSeek DOM extractor, Search/DeepThink toggles
│   │   │   ├── gemini.driver.ts       # Rich-text Quill input, citation/canvas cleaner
│   │   │   └── settling-detector.ts   # 3-signal streaming settling detector
│   │   └── storage/
│   │       ├── sqlite-ledger.adapter.ts # bun:sqlite immutable turn ledger & snapshot store
│   │       └── workspace-sink.adapter.ts # Writes .convo/CONTEXT.md & workspace code artifacts
│   ├── entrypoints/
│   │   ├── cli.ts                     # CLI runner (convo doctor, convo ask, convo compare, etc.)
│   │   └── mcp.ts                     # MCP stdio server for Antigravity / Claude Code / OpenCode
│   └── container.ts                   # Dependency Injection container wiring Ports to Adapters
├── package.json
└── tsconfig.json
```

---

### 2.3 The Core Port Contracts (`src/core/ports/`)

#### 1. `BrowserPort` (`src/core/ports/browser.port.ts`)
```typescript
export interface TabDescriptor {
  targetId: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

export interface SessionHandle {
  readonly sessionId: string;
  readonly targetId: string;
  readonly adapterId: "raw-cdp" | "firefox-bidi" | "agent-browser";
}

export interface TransportHealth {
  ok: boolean;
  adapterId: string;
  endpoint: string;
  openTabsCount: number;
  latencyMs: number;
  error?: string;
}

export interface BrowserPort {
  readonly id: "raw-cdp" | "firefox-bidi" | "agent-browser";

  health(): Promise<TransportHealth>;
  listTabs(): Promise<TabDescriptor[]>;

  /** Attaches to a specific tab target without stealing OS window focus */
  attach(targetId: string): Promise<SessionHandle>;

  /** Cleanly severs the WebSocket connection; NEVER closes the user's tab or browser */
  detach(handle: SessionHandle): Promise<void>;

  /** Forces background tab rendering pipeline active without bringToFront() */
  keepAliveInBackground(handle: SessionHandle): Promise<void>;

  /** Only called when a CAPTCHA/Auth challenge requires human intervention */
  bringToFront(handle: SessionHandle): Promise<void>;

  /** Universal execution denominator across all transports */
  evaluate<T>(handle: SessionHandle, expression: string): Promise<T>;

  /** Atomic text injection that does not trigger premature Enter submissions */
  fillText(handle: SessionHandle, selector: string, text: string): Promise<void>;
  click(handle: SessionHandle, selector: string): Promise<void>;
  pressKey(handle: SessionHandle, selector: string, key: string): Promise<void>;
  setInputFiles(handle: SessionHandle, selector: string, filePaths: string[]): Promise<void>;
}
```

#### 2. `PlatformPort` (`src/core/ports/platform.port.ts`)
```typescript
import { BrowserPort, SessionHandle } from "./browser.port.js";

export type PlatformId = "deepseek" | "chatgpt" | "gemini" | "claude";

export interface CodeBlock {
  language: string;
  code: string;
}

export interface ConversationTurn {
  turnIndex: number;
  role: "user" | "assistant";
  markdownContent: string;
  codeBlocks: CodeBlock[];
  contentHash: string;
}

export interface SelectorResolution {
  ok: boolean;
  layoutVariant: string;
  composerSelector: string | null;
  sendButtonSelector: string | null;
  stopIndicatorSelector: string | null;
  turnContainerSelector: string | null;
  blockerState?: "auth_required" | "captcha" | "rate_limited" | null;
}

export interface ToggleOptions {
  search?: boolean;
  think?: boolean;
}

export interface TurnFingerprint {
  turnCount: number;
  lastTurnHash: string;
  submittedPromptHash?: string;
}

export interface CompletionResult {
  status: "complete" | "incomplete_timeout" | "interrupted";
  turn: ConversationTurn;
  elapsedMs: number;
}

export interface PlatformPort {
  readonly id: PlatformId;

  matchesUrl(url: string): boolean;
  extractThreadId(url: string): string;

  /** Tests selector fallback chains against the live DOM without mutating state */
  resolveSelectors(handle: SessionHandle, browser: BrowserPort): Promise<SelectorResolution>;

  /** Cold path: extracts full or partial existing conversation with intact code indentation */
  readThread(
    handle: SessionHandle,
    browser: BrowserPort,
    options?: { lastNTurns?: number }
  ): Promise<{ layoutVariant: string; turns: ConversationTurn[] }>;

  /** Configures platform-specific toggles (e.g., DeepSeek Search / DeepThink) */
  applyToggles(handle: SessionHandle, browser: BrowserPort, toggles: ToggleOptions): Promise<void>;

  /** Injects prompt and triggers submission, returning pre-submission fingerprint */
  submitPrompt(
    handle: SessionHandle,
    browser: BrowserPort,
    prompt: string,
    files?: string[]
  ): Promise<TurnFingerprint>;

  /** Waits for generation completion via in-page observer promise; returns partial content on timeout */
  awaitCompletion(
    handle: SessionHandle,
    browser: BrowserPort,
    before: TurnFingerprint,
    timeoutMs: number
  ): Promise<CompletionResult>;
}
```

#### 3. `ThreadStore` (`src/core/ports/storage.port.ts`)
```typescript
import { ConversationTurn, PlatformId } from "./platform.port.js";
import { ContextPacket } from "./compiler.port.js";

export interface ThreadRecord {
  threadId: string;
  platform: PlatformId;
  title: string;
  url: string;
  lastSyncedTurnCount: number;
  latestPacketHash?: string;
  updatedAt: string;
}

export interface ThreadStore {
  upsertThread(record: ThreadRecord): Promise<void>;
  appendTurns(threadId: string, turns: ConversationTurn[]): Promise<void>;
  getTurns(threadId: string, lastNTurns?: number): Promise<ConversationTurn[]>;
  savePacket(packet: ContextPacket): Promise<void>;
  getLatestPacket(threadIdOrProjectId: string): Promise<ContextPacket | null>;
  listThreads(platform?: PlatformId): Promise<ThreadRecord[]>;
}
```

#### 4. `ContextCompiler` (`src/core/ports/compiler.port.ts`)
```typescript
import { ConversationTurn, PlatformId } from "./platform.port.js";

export interface ContextPacket {
  projectId: string;
  packetHash: string; // SHA-256 of deterministic markdown body
  sourceThreadId: string;
  platform: PlatformId;
  sourceTurnRange: [number, number];
  layoutVariant: string;
  compiledAt: string;
  markdownBody: string;
  structured: {
    activeInvariants: string[];
    settledDecisions: string[];
    discardedApproaches: string[];
    canonicalInterfaces: Array<{ language: string; code: string }>;
    immediateDirective: string;
  };
}

export interface ContextCompilerPort {
  compile(params: {
    projectId: string;
    threadId: string;
    platform: PlatformId;
    layoutVariant: string;
    turns: ConversationTurn[];
  }): ContextPacket;
}
```

#### 5. `PolicyGate` (`src/core/ports/policy.port.ts`)
```typescript
export type RiskLabel =
  | "contains_shell_execution"
  | "contains_destructive_command"
  | "contains_redacted_secret";

export interface SanitizedPayload {
  cleanText: string;
  redactedCount: number;
  labels: RiskLabel[];
}

export interface PolicyGatePort {
  /** Scrubs outgoing local secrets (.env keys, tokens) before sending to web browser */
  sanitizeOutboundPrompt(rawPrompt: string): SanitizedPayload;

  /** Labels inbound AI responses for risky commands WITHOUT blocking stdio */
  classifyInboundResponse(markdown: string): RiskLabel[];
}
```

---

### 2.4 Core Operational Data Flows

#### Flow A: `convo doctor` (Zero-Mutation Health & Selector Audit)
1. Resolves host environment (`HostEnv`) and checks if TCP port `127.0.0.1:9222` is reachable.
2. Calls `BrowserPort.listTabs()` and matches URLs against registered `PlatformPort` drivers (`deepseek`, `chatgpt`, `gemini`, `claude`).
3. For each matching AI tab, attaches a temporary session and runs `driver.resolveSelectors(handle, browser)`.
4. Prints a diagnostic table showing Target ID, Platform, Title, Matched Layout Variant, Composer status, and any active blockers (CAPTCHA / logged out), then cleanly detaches.

#### Flow B: `convo sync` / MCP `sync_web_context` (Cold Ingestion to Local Workspace)
1. Fuzzy-matches the requested tab (by platform, URL, or title keyword).
2. Acquires a non-blocking read lock on the tab's `targetId`.
3. Runs `driver.readThread(handle, browser)` which clones each message node in the DOM, removes UI buttons/SVGs, replaces `<pre><code>` with fenced `.textContent` blocks, and returns structured `ConversationTurn[]`.
4. Stores immutable turns in `SqliteLedgerStore` (`~/.local/share/convolink/ledger.sqlite`).
5. Runs `ContextCompiler.compile()` to extract decisions, constraints, latest code interfaces, and the tail directive into a deterministic Markdown string with a SHA-256 `packetHash`.
6. Writes `.convo/CONTEXT.md` and `.convo/PROVENANCE.json` into the active project repository and returns the packet to the CLI agent.

#### Flow C: `convo ask` / MCP `convo_ask` (Hot Path with Safety & Fingerprinting)
1. Runs `PolicyGate.sanitizeOutboundPrompt()` to strip any accidental `.env` secrets or API keys.
2. Acquires an exclusive per-tab mutex lock in `$XDG_RUNTIME_DIR/convolink/tab-<targetId>.lock`.
3. Calls `browser.keepAliveInBackground(handle)` so Chrome doesn't throttle the tab while keeping the user's terminal focused.
4. Calls `driver.applyToggles(handle, browser, { search, think })`.
5. Captures `beforeFingerprint` (turn count + hash of current last turn), injects prompt atomically via `fillText`, and submits.
6. Calls `driver.awaitCompletion(handle, browser, beforeFingerprint, timeoutMs)` using 3-signal settling.
7. Updates the ledger, releases the mutex lock, detaches the WebSocket, and returns the response + metadata.

---

## Part 3: Architecture Decision Records (`docs/ADR.md`)

The authoritative, unified registry of all 16 Architecture Decision Records (ADR-001 through ADR-016) is maintained in [`docs/ADR.md`](./ADR.md).

Key decisions codified in `docs/ADR.md`:
- **ADR-001:** Hexagonal Ports & Adapters with Zero-Dependency Native CDP & Pruned Playwright
- **ADR-002:** 3-Signal Streaming Settling & In-Page DOM Extraction
- **ADR-003:** Ordered Selector Fallback Chains with Layout Telemetry
- **ADR-004:** Safe WebSocket Detach (`disconnect`) & Zero-Focus Background Execution
- **ADR-005:** Symmetric Immutable SQLite Ledger & Deterministic Context Packets
- **ADR-006:** Non-Blocking Policy Gate (Secret Scrubbing & Inbound Risk Tagging)
- **ADR-007:** Fedora Linux First (`XDG` & `tmpfs`), Cross-Platform Abstracted
- **ADR-008:** Reactive Form Injection & Modern Composer Standards
- **ADR-009:** Background Tab Throttling Mitigation via CDP Focus Emulation
- **ADR-010:** Virtualized DOM Scroll-Chunk Traversal & Deduplication
- **ADR-011:** Resilient PID-Aware tmpfs Mutex Locking with Active Heartbeat Leases
- **ADR-012:** Capability-Driven Cross-Browser BiDi & CDP Decoupling
- **ADR-013:** High-Fidelity Multi-Model Comparison & Staggered Dispatch
- **ADR-014:** Two-Stage Technical Arbiter Consensus Engine
- **ADR-015:** Durable SQLite Turn Ledger via `bun:sqlite` with FTS5 Search
- **ADR-016:** Non-Blocking Model Context Protocol (MCP) Server

---

## Part 4: Step-by-Step Build Roadmap for Antigravity (`BUILD_ROADMAP.md`)

Feed these phases sequentially to Antigravity so each layer is verified before the next begins:

- [ ] **Phase 1: Foundation & Contracts**
  - Initialize `package.json` (Bun + TypeScript strict ESM) and `tsconfig.json`.
  - Implement `src/core/env/host-env.ts` (Fedora XDG & `tmpfs` lock paths + Chrome binary locator).
  - Create all core port interfaces in `src/core/ports/` and structured error types in `src/core/errors/`.
  - Verify with `bun run typecheck`.

- [ ] **Phase 2: Transport Layer & `convo doctor`**
  - Implement `RawCdpAdapter` (direct WebSocket to `127.0.0.1:9222/json/list` and target WS endpoints) and `FirefoxBidiAdapter`.
  - Implement `DeepSeekDriver.resolveSelectors()` and `ChatGPTDriver.resolveSelectors()`.
  - Wire `bun convo doctor` in `src/entrypoints/cli.ts` to inspect live open tabs on port `9222` and report matched layout variants.

- [ ] **Phase 3: DeepSeek Driver (Cold Read + Hot Ask)**
  - Implement `DeepSeekDriver.readThread()` with DOM cloning, UI button stripping, and `<pre><code>.textContent` extraction.
  - Implement `DeepSeekDriver.applyToggles()` (`Search` and `DeepThink`), `submitPrompt()`, and `awaitCompletion()` (SVG `linearGradient` spinner + turn count fingerprint + DOM stabilization).
  - Test `bun convo read --platform deepseek` and `bun convo ask "..." --think` against your live Chrome session.

- [ ] **Phase 4: Continuity Ledger & Context Compiler (`convo sync`)**
  - Implement `SqliteLedgerStore` (`bun:sqlite`) and `WorkspaceSink` (`.convo/CONTEXT.md`).
  - Implement `ContextCompiler` to distill turns into invariants, settled decisions, canonical interfaces, and latest directives with SHA-256 fingerprinting.
  - Test `bun convo sync --platform deepseek` and inspect the generated `.convo/CONTEXT.md`.

- [ ] **Phase 5: Policy Gate, Per-Tab Locking & MCP Server**
  - Implement `LockService` using `$XDG_RUNTIME_DIR/convolink` lockfiles and `PolicyService` secret redaction.
  - Implement `src/entrypoints/mcp.ts` exposing all 8 tools including `convo_ask`, `convo_compare`, `convo_search`.
  - Register the MCP server in Antigravity / Claude Code and run an end-to-end continuity test.

- [ ] **Phase 6: Multi-Platform Expansion (ChatGPT, Gemini, Claude & Rollover)**
  - Implement full `ChatGPTDriver`, `GeminiDriver`, and `ClaudeDriver`.
  - Add `convo rollover` to seed a fresh tab from `.convo/CONTEXT.md` when a long thread hits its context ceiling.
