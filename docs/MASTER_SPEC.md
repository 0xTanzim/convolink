# OMNI-BRIDGE: Continuity Runtime & Cross-Browser AI Architecture
**Document Type:** Master System Specification, Project Brief & Architecture Decision Records (ADRs)
**Target Environment:** Fedora Linux First (`XDG` / `tmpfs` native), Cross-Platform Ready (macOS / Windows)
**Runtime Stack:** TypeScript (Strict ESM on Bun / Node.js), Optional Rust Native Extensions, Minimal POSIX Shell Bootstrapper

---

## Part 1: Project Brief & Vision (`PROJECT_BRIEF.md`)

### 1.1 The Problem Statement: The "Dual-Brain Amnesia" Gap
Modern software engineering happens across two isolated surfaces:
1. **The Web Brain Surface (ChatGPT, DeepSeek, Gemini):** Where engineers spend hours doing deep R&D, debating system trade-offs, exploring edge cases, and running long-horizon reasoning (`DeepThink` / `o-series` / `Gemini Thinking`) with zero per-token API cost.
2. **The Local Executor Surface (Claude Code, Antigravity, OpenCode, Codex):** Where autonomous CLI coding agents inspect local files, run compilers, and edit repositories.

**The Disconnect:** When an engineer moves from a 2-hour browser R&D session to their terminal, the local CLI coding agent starts with **total amnesia**. The human is forced to act as a manual clipboard—copying architecture specs from the browser, pasting them into the CLI, copying terminal stack traces, and pasting them back into the browser.

Existing open-source tools fail to solve this because they are built as brittle "prompt senders" that either:
- Spawn isolated, logged-out Chrome profiles that cannot see the user's real browser tabs.
- Destroy code block indentation through naive `.innerText` scraping.
- Cut off reasoning models prematurely during silent thinking pauses.
- Steal OS window focus (`bringToFront()`) every time a background query runs.
- Dump raw 50-turn chat transcripts into the CLI agent, polluting its context window and burning tokens.

### 1.2 The Solution: A Cognitive Continuity Runtime
**`omni-bridge`** is not a simple scraper or API wrapper. It is a **local-first Continuity Runtime** built on **Hexagonal Architecture (Ports & Adapters)** with strict **Dependency Injection (DI)**.

It connects directly to the developer's already-running browser (`ws://127.0.0.1:9222`), treats live web chat tabs as stateful architectural producers, distills raw discussions into deterministic, SHA-256 fingerprinted **Context Packets** (`.omni/CONTEXT.md`), and exposes a unified CLI and Model Context Protocol (MCP) surface so local coding agents (Antigravity, Claude Code, OpenCode) can inherit web R&D history and consult live browser tabs with zero manual copy-pasting.

### 1.3 Core Engineering Goals
1. **Zero-Coupling Core Kernel:** `src/core/` never imports `playwright`, `ws`, `puppeteer`, or any browser library. All browser transports (`RawCdpAdapter`, `PlaywrightAdapter`, `AgentBrowserAdapter`) and AI platforms (`DeepSeekDriver`, `ChatGPTDriver`, `GeminiDriver`) are hot-swappable plugins behind strict TypeScript interfaces.
2. **Symbiosis with Live Browser Sessions:** Attaches to the user's real, authenticated Chrome/Brave/Chromium tabs without spawning duplicate browser windows or calling `browser.close()`.
3. **Zero Window-Focus Theft:** Executes background tab interactions using CDP lifecycle emulation (`Page.setWebLifecycleState` & `Emulation.setFocusEmulationEnabled`) so the user's terminal and cursor are never interrupted.
4. **100% Code Indentation Fidelity:** Bypasses brittle `.innerText` space collapse by cloning DOM containers, stripping UI chrome (`Copy` buttons, SVGs, toolbars), and extracting `<pre><code>` blocks via `.textContent`.
5. **Multi-Signal Stream Completion:** Prevents premature cutoff during `DeepThink` / reasoning pauses by conjoining UI spinner states, thinking-block transitions, turn fingerprinting, and DOM quiescence inside a single in-page observer promise.
6. **Deterministic Context Compilation:** Compiles multi-turn web discussions into a compact, cache-stable `.omni/CONTEXT.md` artifact containing active invariants, settled decisions, discarded approaches, canonical code interfaces, and immediate directives.

---

## Part 2: System Architecture Specification (`ARCHITECTURE.md`)

### 2.1 High-Level Hexagonal Topology (Ports & Adapters)

```text
                  INBOUND DRIVING SURFACES (Entrypoints)
       ┌──────────────────────────┬──────────────────────────┐
       │    MCP Server (stdio)    │     Smart CLI (`omni`)   │
       │ (Antigravity/Claude Code)│ (doctor, sync, ask, tabs)│
       └────────────┬─────────────┴─────────────┬────────────┘
                    │                           │
                    ▼                           ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                       OMNI-BRIDGE CONTINUITY KERNEL                        │
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
│ • ChatGPTDriver         │  │   (Immutable turns)  │  │ • PlaywrightAdapter │
│ • GeminiDriver          │  │ • WorkspaceMdStore   │  │ • AgentBrowserCli   │
│                         │  │   (.omni/CONTEXT.md) │  │                     │
└─────────────────────────┘  └──────────────────────┘  └─────────────────────┘
```

### 2.2 Target Repository Directory Structure

```text
omni-bridge/
├── docs/
│   ├── PROJECT_BRIEF.md               # Vision, problem statement, and goals
│   ├── ARCHITECTURE.md                # System topology, ports, and data flows
│   └── ADR.md                         # Architecture Decision Records (ADR-001 to ADR-008)
├── scripts/
│   └── fedora-chrome-debug.sh         # POSIX helper to verify/launch Chrome on 127.0.0.1:9222
├── src/
│   ├── core/                          # PURE DOMAIN KERNEL (Zero external browser imports)
│   │   ├── env/
│   │   │   └── host-env.ts            # Cross-platform path resolver (Fedora XDG/tmpfs first)
│   │   ├── ports/
│   │   │   ├── browser.port.ts        # BrowserPort interface (attach, evaluate, fill, etc.)
│   │   │   ├── platform.port.ts       # PlatformPort interface (readThread, submit, toggles)
│   │   │   ├── storage.port.ts        # ThreadStore & WorkspaceArtifactStore interfaces
│   │   │   ├── compiler.port.ts       # ContextCompiler & ContextPacket contracts
│   │   │   └── policy.port.ts         # PolicyGate secret scrubbing & risk tagging contract
│   │   ├── services/
│   │   │   ├── orchestrator.ts        # Main use-case coordinator (doctor, sync, ask, rollover)
│   │   │   ├── compiler.service.ts    # Deterministic Context Packet compiler
│   │   │   ├── lock.service.ts        # Per-tab mutex lock manager ($XDG_RUNTIME_DIR)
│   │   │   └── policy.service.ts      # Secret redaction (.env, API keys) & shell classification
│   │   └── errors/
│   │       └── bridge-errors.ts       # Structured error taxonomy (Auth, RateLimit, Timeout)
│   ├── adapters/                      # SWAPPABLE INFRASTRUCTURE PLUGINS
│   │   ├── browsers/
│   │   │   ├── raw-cdp.adapter.ts     # Direct WebSocket CDP client (per-tab target pinning)
│   │   │   ├── playwright.adapter.ts  # Playwright connectOverCDP wrapper (safe disconnect)
│   │   │   └── agent-browser.adapter.ts # CLI wrapper around `agent-browser --cdp 9222`
│   │   ├── platforms/
│   │   │   ├── deepseek.driver.ts     # DeepSeek DOM extractor, Search/DeepThink toggles, SVG wait
│   │   │   ├── chatgpt.driver.ts      # Multi-layout fallback chain, ProseMirror input
│   │   │   └── gemini.driver.ts       # Rich-text Quill input, citation/canvas cleaner
│   │   └── storage/
│   │       ├── sqlite-ledger.adapter.ts # bun:sqlite immutable turn ledger & snapshot store
│   │       └── workspace-md.adapter.ts  # Writes .omni/CONTEXT.md & .omni/PROVENANCE.json
│   ├── entrypoints/
│   │   ├── cli.ts                     # CLI runner (`omni doctor`, `omni sync`, `omni ask`)
│   │   └── mcp.ts                     # MCP stdio server for Antigravity / Claude Code / OpenCode
│   └── container.ts                   # Dependency Injection container wiring Ports to Adapters
├── package.json
└── tsconfig.json
```

---

### 2.3 The Five Core Port Contracts (`src/core/ports/`)

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
  readonly adapterId: "raw-cdp" | "playwright" | "agent-browser";
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
  readonly id: "raw-cdp" | "playwright" | "agent-browser";

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

export type PlatformId = "deepseek" | "chatgpt" | "gemini";

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

#### Flow A: `omni doctor` (Zero-Mutation Health & Selector Audit)
1. Resolves host environment (`HostEnv`) and checks if TCP port `127.0.0.1:9222` is reachable.
2. Calls `BrowserPort.listTabs()` and matches URLs against registered `PlatformPort` drivers (`deepseek`, `chatgpt`, `gemini`).
3. For each matching AI tab, attaches a temporary session and runs `driver.resolveSelectors(handle, browser)`.
4. Prints a diagnostic table showing Target ID, Platform, Title, Matched Layout Variant, Composer status, and any active blockers (CAPTCHA / logged out), then cleanly detaches.

#### Flow B: `omni sync` / MCP `sync_web_context` (Cold Ingestion to Local Workspace)
1. Fuzzy-matches the requested tab (by platform, URL, or title keyword).
2. Acquires a non-blocking read lock on the tab's `targetId`.
3. Runs `driver.readThread(handle, browser)` which clones each message node in the DOM, removes UI buttons/SVGs, replaces `<pre><code>` with fenced `.textContent` blocks, and returns structured `ConversationTurn[]`.
4. Stores immutable turns in `SqliteLedgerStore` (`~/.local/share/omni-bridge/ledger.sqlite`).
5. Runs `ContextCompiler.compile()` to extract decisions, constraints, latest code interfaces, and the tail directive into a deterministic Markdown string with a SHA-256 `packetHash`.
6. Writes `.omni/CONTEXT.md` and `.omni/PROVENANCE.json` into the active project repository and returns the packet to the CLI agent.

#### Flow C: `omni ask` / MCP `consult_web_architect` (Hot Path with Safety & Fingerprinting)
1. Runs `PolicyGate.sanitizeOutboundPrompt()` to strip any accidental `.env` secrets or API keys.
2. Acquires an exclusive per-tab mutex lock in `$XDG_RUNTIME_DIR/omni-bridge/tab-<targetId>.lock`.
3. Calls `browser.keepAliveInBackground(handle)` so Chrome doesn't throttle the tab while keeping the user's terminal focused.
4. Calls `driver.applyToggles(handle, browser, { search, think })`.
5. Captures `beforeFingerprint` (turn count + hash of current last turn), injects prompt atomically via `fillText`, and submits.
6. Calls `driver.awaitCompletion(handle, browser, beforeFingerprint, timeoutMs)`.
   - Inside the page, waits until `turnCount > before.turnCount`, the stop button/gradient spinner disappears, and DOM text stabilizes for 800ms.
   - If `timeoutMs` is reached while still generating, returns `status: "incomplete_timeout"` with the partial text generated so far rather than throwing away the output.
7. Updates the ledger, releases the mutex lock, detaches the WebSocket, and returns the response + `provenance` metadata.

---

## Part 3: Architecture Decision Records (`ADR.md`)

### ADR-001: Hexagonal Ports & Adapters over Direct Playwright/CDP Coupling
* **Status:** Accepted
* **Context:** Browser automation tools evolve rapidly (`Playwright`, `agent-browser` in Rust, raw CDP WebSockets, MV3 Native Messaging). Additionally, Playwright's `connectOverCDP` has exhibited handshake delays under certain Bun versions compared to raw WebSockets or Node.
* **Decision:** Isolate all core orchestration, compilation, locking, and MCP logic inside `src/core/` with zero external browser dependencies. Define `BrowserPort` and `PlatformPort` interfaces and wire implementations in `src/container.ts`.
* **Consequences:** We can swap `PlaywrightAdapter`, `RawCdpAdapter`, and `AgentBrowserAdapter` via a CLI flag or config setting without touching a single line of core business logic.

### ADR-002: Dual-Phase Ingestion (Cold DOM Tree-Walker + Hot In-Page Observer)
* **Status:** Accepted
* **Context:** Network SSE interception only works while bytes are actively streaming over the wire; it cannot read a 30-turn R&D conversation that finished loading 20 minutes ago. Conversely, naive `.innerText` scraping destroys code indentation and grabs UI button text (`"typescriptCopy code"`).
* **Decision:**
  1. For reading existing turns (**Cold Path**), inject an in-page DOM walker that clones turn containers, strips known UI chrome selectors, and extracts `<pre><code>` via `.textContent` before reading prose.
  2. For awaiting new responses (**Hot Path**), inject an in-page async Promise combining UI state indicators (e.g., SVG spinner/stop button absence) with DOM mutation quiescence.
* **Consequences:** Historical threads are captured with 100% whitespace fidelity, and active `DeepThink` streams are never cut off during silent reasoning pauses.

### ADR-003: Ordered Selector Fallback Chains with Layout Telemetry
* **Status:** Accepted
* **Context:** AI web platforms frequently A/B test DOM structures (e.g., ChatGPT alternating between `article`, `[data-testid^="conversation-turn-"]`, and `[data-turn-key]`). Hardcoding a single CSS selector causes silent failures.
* **Decision:** Every `PlatformPort` driver defines ordered fallback arrays for turn containers, role markers, composers, and action buttons. `resolveSelectors()` tests each tier in order and records the winning `layoutVariant` in the tool's provenance output.
* **Consequences:** UI updates degrade gracefully to fallback tiers instead of crashing, and `omni doctor` immediately pinpoints which selector tier matched.

### ADR-004: Safe WebSocket Detach (`disconnect`) & Zero-Focus Background Execution
* **Status:** Accepted
* **Context:** Calling `browser.close()` on a CDP-attached Playwright instance can kill the user's entire Chrome session. Calling `page.bringToFront()` steals window focus from the developer's terminal every time an agent runs a background query.
* **Decision:**
  1. Ban `browser.close()` across all adapters; `detach()` must only close the local WebSocket client connection.
  2. Ban default `bringToFront()`; use CDP `Page.setWebLifecycleState({ state: "active" })` and `Emulation.setFocusEmulationEnabled({ enabled: true })` to defeat background tab throttling silently. Only call `bringToFront()` when a CAPTCHA or login prompt requires human interaction.
* **Consequences:** The developer's browser tabs stay untouched and never pop over their code editor.

### ADR-005: Immutable SQLite Ledger + Deterministic Context Packet (`.omni/CONTEXT.md`)
* **Status:** Accepted
* **Context:** Dumping raw chat transcripts into Claude Code or Antigravity wastes context tokens and forces the local model to re-derive decisions on every turn. Complex RDF knowledge graphs with embeddings add heavy operational latency for v1.
* **Decision:** Maintain an append-only SQLite ledger of raw turns (`bun:sqlite`) and compile a deterministic, SHA-256 fingerprinted **Context Packet** written to `.omni/CONTEXT.md` (and served via MCP). If the `packetHash` matches the agent's `lastKnownHash`, return `UNCHANGED` (0 token cost).
* **Consequences:** Local CLI agents get immediate architectural clarity via a local markdown file or MCP call while keeping prompt caches warm.

### ADR-006: Non-Blocking Policy Gate (Classify & Scrub, Never Halt `stdio`)
* **Status:** Accepted
* **Context:** Halting an MCP server or background CLI pipe to wait for interactive `[Enter]` confirmation on `stdin` deadlocks the parent coding agent (which owns `stdio` for JSON-RPC communication).
* **Decision:** The `PolicyGate` automatically scrubs outgoing local secrets (API keys, `.env` patterns) before prompt injection, and tags incoming AI responses with metadata labels (`contains_shell_execution`, `contains_destructive_command`). Execution approval is delegated to the host CLI agent's native permission gate.
* **Consequences:** Zero `stdio` deadlocks, automatic protection against leaking secrets to web chats, and full visibility into risky commands.

### ADR-007: Fedora Linux First (`XDG` & `tmpfs`), Cross-Platform Abstracted
* **Status:** Accepted
* **Context:** The primary development workstation runs Fedora Linux with Btrfs and `$XDG_RUNTIME_DIR` mounted on RAM (`tmpfs`), while future users may run macOS or Windows.
* **Decision:** Centralize all OS paths and browser discovery inside `src/core/env/host-env.ts`. On Linux, store high-frequency tab mutex locks in `$XDG_RUNTIME_DIR/omni-bridge` (`/run/user/1000/omni-bridge` — zero SSD wear, auto-cleaned on reboot) and persistent SQLite data in `$XDG_DATA_HOME/omni-bridge`. Provide automatic fallbacks for `darwin` and `win32`.
* **Consequences:** Native Linux performance and hygiene on Fedora today, with zero refactoring needed for macOS/Windows support tomorrow.

### ADR-008: Reactive Form Injection & Modern ProseMirror/Quill Composer Standards
* **Status:** Accepted
* **Context:** Empirical testing on live active tabs (`chatgpt.com`, `deepseek.com`, `gemini.google.com`) and post-mortem analysis of `/home/tanzim/Learning/ai/url_test/bridge.py` revealed why previous bridge attempts broke:
  1. Setting `textarea.value = ...` or calling naive `locator.fill()` fails to notify React 18 / Vue reactive internal state trackers on DeepSeek, leaving the circle send button disabled (`ds-button--circle disabled`).
  2. Modern ChatGPT (2026 build) removed `id="prompt-textarea"` and `[data-message-author-role]`. The composer is now `div.ProseMirror[contenteditable="true"][role="textbox"]`, and messages render inside virtualized `[data-turn-key]` with child `DIV.block-BQZwFn` nodes labeled via accessibility headings (`You said:` / `ChatGPT said:`).
  3. Gemini uses custom Web Components (`<user-query>`, `<model-response>`) with a Quill rich-text composer (`rich-textarea div.ql-editor.textarea`) and dynamic `button[aria-label="Send message"]`.
  4. Multi-line markdown blocks with blank lines (`\n\n`) passed to in-page `document.execCommand('insertText')` can cause ProseMirror to split paragraphs into disjoint blocks or accidentally fire an Enter submit handler.
* **Decision:**
  - For standard `<textarea>` elements (DeepSeek): use `Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, text)` followed by `ta.dispatchEvent(new Event('input', { bubbles: true }))`.
  - For contenteditable editors (ChatGPT ProseMirror, Gemini Quill): prioritize native CDP `Input.insertText({ text })` which operates at the browser engine level, preserving multi-line newlines without triggering form submits.
  - For response extraction: parse structured role demarcations per platform (`[data-turn-key]` for ChatGPT, `<model-response>` for Gemini, `.ds-markdown` for DeepSeek) with `<pre><code>.textContent` for code blocks.
* **Consequences:** Zero silent input drops across all three major platforms, zero newline split glitches in ProseMirror, and resilient response extraction.

### ADR-009: Background Tab Throttling Mitigation via CDP Focus Emulation
* **Status:** Accepted
* **Context:** Empirical measurements on background Chrome tabs revealed severe timer drift (a 100ms timer drifted to 743ms on Linux Chrome) due to Chromium's aggressive background tab budget suspension and throttling of Web Workers / SSE streams.
* **Decision:**
  Before dispatching prompts or awaiting streaming responses on background tabs, issue low-level CDP commands:
  ```json
  Emulation.setFocusEmulationEnabled({ "enabled": true })
  Page.setWebLifecycleState({ "state": "active" })
  ```
* **Consequences:** Background tabs execute at full foreground CPU priority, network SSE events are processed in real-time, and OS window focus is never stolen from the user's active editor or terminal.

### ADR-010: Virtualized DOM Scroll-Chunk Traversal & Deduplication
* **Status:** Accepted
* **Context:** Modern web chat applications (e.g. ChatGPT `data-turn-key` virtualized lists) recycle DOM nodes, keeping only ~6 visible turns in memory for performance. Reading a 40-turn R&D thread without scroll-offset awareness results in incomplete history ingestion (turns 1–34 missing).
* **Decision:** In `PlatformPort.readThread`, the driver inspects total container height and turn indices. If the thread is virtualized, it smoothly traverses the scroll container in ascending chunks (`scrollTop`), harvesting `ConversationTurn` items into a Map keyed by canonical `turnKey` or content hash until the entire transcript is ingested.
* **Consequences:** 100% transcript recovery on long multi-hour architectural threads with zero missing historical turns.

### ADR-011: Resilient PID-Aware tmpfs Mutex Locking with Stale Lock Reclamation
* **Status:** Accepted
* **Context:** Mutual exclusion locks are held in `/run/user/1000/omni-bridge/tab-<targetId>.lock` ($XDG_RUNTIME_DIR). If an agent process is killed via `SIGKILL` (`kill -9`) or an unexpected crash, stale lockfiles can deadlock future operations.
* **Decision:**
  Lockfiles store a JSON payload: `{"pid": number, "createdAt": number, "targetId": string}`.
  When acquiring a lock:
  1. If the file exists, test if the owning process is alive via POSIX `process.kill(pid, 0)`.
  2. If the PID is dead or if `Date.now() - createdAt > LOCK_TTL_MS` (default: 120s), log a warning, unlink the stale lock, and safely acquire.
* **Consequences:** Crash-proof mutex locking on RAM with zero manual lock file deletion required.

---

## Part 4: Step-by-Step Build Roadmap for Antigravity (`BUILD_ROADMAP.md`)

Feed these phases sequentially to Antigravity so each layer is verified before the next begins:

- [ ] **Phase 1: Foundation & Contracts**
  - Initialize `package.json` (Bun + TypeScript strict ESM) and `tsconfig.json`.
  - Implement `src/core/env/host-env.ts` (Fedora XDG & `tmpfs` lock paths + Chrome binary locator).
  - Create all 5 port interfaces in `src/core/ports/` and structured error types in `src/core/errors/`.
  - Verify with `bun run typecheck`.

- [ ] **Phase 2: Transport Layer & `omni doctor`**
  - Implement `RawCdpAdapter` (direct WebSocket to `127.0.0.1:9222/json/list` and target WS endpoints) and/or `PlaywrightAdapter` (with safe disconnect).
  - Implement `DeepSeekDriver.resolveSelectors()` and `ChatGPTDriver.resolveSelectors()`.
  - Wire `bun omni doctor` in `src/entrypoints/cli.ts` to inspect live open tabs on port `9222` and report matched layout variants.

- [ ] **Phase 3: DeepSeek Driver (Cold Read + Hot Ask)**
  - Implement `DeepSeekDriver.readThread()` with DOM cloning, UI button stripping, and `<pre><code>.textContent` extraction.
  - Implement `DeepSeekDriver.applyToggles()` (`Search` and `DeepThink`), `submitPrompt()`, and `awaitCompletion()` (SVG `linearGradient` spinner + turn count fingerprint + DOM stabilization).
  - Test `bun omni read --platform deepseek` and `bun omni ask "..." --think` against your live Chrome session.

- [ ] **Phase 4: Continuity Ledger & Context Compiler (`omni sync`)**
  - Implement `SqliteLedgerStore` (`bun:sqlite`) and `WorkspaceMdStore` (`.omni/CONTEXT.md`).
  - Implement `ContextCompiler` to distill turns into invariants, settled decisions, canonical interfaces, and latest directives with SHA-256 fingerprinting.
  - Test `bun omni sync --platform deepseek` and inspect the generated `.omni/CONTEXT.md`.

- [ ] **Phase 5: Policy Gate, Per-Tab Locking & MCP Server**
  - Implement `LockService` using `$XDG_RUNTIME_DIR/omni-bridge` lockfiles and `PolicyService` secret redaction.
  - Implement `src/entrypoints/mcp.ts` exposing `list_ai_tabs`, `sync_web_context`, `get_context_packet`, and `consult_web_architect`.
  - Register the MCP server in Antigravity / Claude Code and run an end-to-end continuity test.

- [ ] **Phase 6: Multi-Platform Expansion (ChatGPT, Gemini & Rollover)**
  - Implement full `ChatGPTDriver` (with multi-layout fallback chain) and `GeminiDriver`.
  - Add `omni rollover` to seed a fresh tab from `.omni/CONTEXT.md` when a long thread hits its context ceiling.
