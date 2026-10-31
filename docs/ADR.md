# ConvoLink Architecture Decision Records (ADRs)

This document represents the unified registry of architectural decisions governing ConvoLink (ADR-001 through ADR-016), incorporating all enhancements and simplifications from Milestones 1 and 2.

---

## ADR-001: Hexagonal Ports & Adapters with Zero-Dependency Native CDP & Pruned Playwright

### Status
Accepted (Revised Milestone 2)

### Context
Browser automation tools evolve rapidly (`Playwright`, `agent-browser`, raw CDP WebSockets, W3C WebDriver BiDi). Initial prototypes evaluated Playwright's `connectOverCDP`. However, empirical benchmarking showed Playwright added 50MB of dependency bloat, external package overhead, and connection handshake delays under Bun.

### Decision
1. Isolate all domain orchestration, locking, comparison, and policy logic inside `src/core/` with strictly zero browser or network imports (**The Zero-Import Isolation Law**).
2. Define abstract interfaces in `src/core/ports/` (`BrowserPort`, `PlatformPort`, `ThreadStore`, `WorkspaceSinkPort`, `PolicyGatePort`).
3. Make the zero-dependency native WebSocket CDP adapter (`RawCdpAdapter`) the primary transport, alongside W3C WebDriver BiDi (`FirefoxBidiAdapter`) and optional `AgentBrowserAdapter`.
4. Prune `playwright` entirely from `package.json` dependencies (DM-16 / F16).

### Consequences
- Zero external runtime npm dependencies (`"dependencies": {}`).
- Sub-millisecond CDP connection latency and 100% pure domain testability with in-memory doubles (`FakeBrowserPort`).

---

## ADR-002: 3-Signal Streaming Settling & In-Page DOM Extraction

### Status
Accepted (Revised Milestone 2)

### Context
Silent pauses during deep reasoning (DeepSeek R1, ChatGPT Think, o-series) caused premature stream cutoff when using naive text length stabilization. Furthermore, standard `.innerText` scraping destroys code indentation and captures UI button text (`"Copy code"`).

### Decision
1. **3-Signal Streaming Settling (`StreamSettlingDetector`):** Generation is declared complete only when all three independent signals coincide:
   - **Signal 1 (Action Container State):** Stop button, gradient spinner, and pause indicators are absent.
   - **Signal 2 (Thinking Container Transition):** Collapsible reasoning/thinking accordions are closed or static (`isThinking: false`).
   - **Signal 3 (Quiescence Window):** Exact text length remains unchanged with zero DOM mutations for at least 400ms continuously.
2. **Indentation-Preserving Extraction:** Clone turn DOM containers in-page, strip known UI chrome SVGs and buttons, and extract `<pre><code>` content via `.textContent` before processing prose markdown.

### Consequences
- Reasoning streams are never cut off during silent calculation intervals.
- 100% whitespace and indentation fidelity across all languages.

---

## ADR-003: Ordered Selector Fallback Chains with Layout Telemetry

### Status
Accepted

### Context
Web AI platforms frequently deploy A/B tests and DOM refactors (e.g. ChatGPT alternating between `article`, `[data-testid^="conversation-turn-"]`, and `[data-turn-key]`). Hardcoding single CSS selectors leads to brittle failures.

### Decision
Every platform driver (`ChatGPTDriver`, `ClaudeDriver`, `DeepSeekDriver`, `GeminiDriver`) defines ordered fallback arrays for composers, buttons, turn containers, and stop indicators. `resolveSelectors()` evaluates each tier sequentially and records the winning `layoutVariant` in telemetry.

### Consequences
- UI changes degrade gracefully to secondary selector tiers without crashing.
- `convo doctor` immediately diagnoses which layout tier matched.

---

## ADR-004: Safe WebSocket Detach (`disconnect`) & Zero-Focus Background Execution

### Status
Accepted

### Context
Calling `browser.close()` on an attached CDP session terminates the user's personal browser window. Calling `page.bringToFront()` steals window focus from the developer's terminal or IDE during coding.

### Decision
1. **Ban `browser.close()`:** Adapters must only sever their local WebSocket connection upon teardown.
2. **Ban default `bringToFront()`:** Background execution uses CDP commands:
   ```json
   Emulation.setFocusEmulationEnabled({ "enabled": true })
   Page.setWebLifecycleState({ "state": "active" })
   ```
3. `bringToFront()` is strictly permitted only when an interactive CAPTCHA or Cloudflare challenge requires human intervention.

### Consequences
- The user's browser, tabs, logins, and cookies remain completely untouched.
- Background prompt submission never steals desktop window focus.

---

## ADR-005: Symmetric Immutable SQLite Ledger & Deterministic Context Packets

### Status
Accepted (Revised Milestone 2)

### Context
Dumping full raw chat logs into coding agents exhausts context windows and burns tokens. Prior implementations only recorded assistant turns, dropping the initiating user prompt from the persistent ledger.

### Decision
1. **Symmetric Ledger Recording:** Record user prompts at turn index N and assistant responses at turn index N+1 monotonically in `ThreadStore`.
2. **Deterministic Context Compilation:** Compile threads into cache-stable `.convo/CONTEXT.md` packets with SHA-256 fingerprinting. If the packet hash matches the agent's cached hash, return `UNCHANGED` (0 token cost).

### Consequences
- Durable, complete transcript reproduction.
- Minimal token consumption for local coding agents.

---

## ADR-006: Non-Blocking Policy Gate (Secret Scrubbing & Inbound Risk Tagging)

### Status
Accepted (Revised Milestone 1)

### Context
Halting an MCP server or CLI pipeline on `stdio` to wait for interactive confirmation deadlocks autonomous coding agents. Leaking accidental `.env` variables or API tokens to public web AI models poses critical security risks.

### Decision
1. **Outbound Secret Scrubbing:** Scan and redact sensitive tokens using strict regexes:
   - OpenAI API keys (`sk-[a-zA-Z0-9_-]{20,}`)
   - GitHub PATs (`ghp_[a-zA-Z0-9]{36}`)
   - AWS access keys (`AKIA[0-9A-Z]{16}`)
   - Generic JWTs (`eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+`)
   - Quoted and unquoted `.env` variable assignments
   - Lookahead guard preventing false-positive redaction of 40-character Git commit SHAs
2. **Non-Blocking Inbound Tagging:** Inspect incoming responses for destructive commands (`rm -rf`, `sudo`, `dd`) and tag payloads with `contains_destructive_command: true` in metadata without pausing `stdio`.

### Consequences
- Zero stdio deadlocks during agent execution.
- High-assurance secret leakage prevention.

---

## ADR-007: Fedora Linux First (`XDG` & `tmpfs`), Cross-Platform Abstracted

### Status
Accepted

### Context
The development workstation runs Fedora Linux with `$XDG_RUNTIME_DIR` mounted in RAM (`tmpfs`), while cross-platform support is required for macOS and Windows.

### Decision
Centralize all environment and path resolutions in `src/core/env/host-env.ts`. On Linux:
- Mutex locks reside in `$XDG_RUNTIME_DIR/convolink/` (RAM `tmpfs`, zero SSD wear, auto-cleaned on reboot).
- Durable database resides in `$XDG_DATA_HOME/convolink/` (`~/.local/share/convolink/ledger.sqlite`).
- Provide automatic fallbacks for macOS (`~/Library/Application Support/convolink`) and Windows (`%LOCALAPPDATA%\convolink`).

### Consequences
- Maximizes I/O throughput on Linux while preserving cross-platform compatibility.

---

## ADR-008: Reactive Form Injection & Modern Composer Standards

### Status
Accepted

### Context
Assigning `textarea.value = ...` fails to notify Vue/React internal state trackers on DeepSeek, leaving the send button disabled. Modern ChatGPT uses contenteditable ProseMirror; Gemini uses Quill.

### Decision
1. For standard `<textarea>` (DeepSeek): use `HTMLTextAreaElement.prototype` property descriptor setter followed by an `input` event dispatch.
2. For ProseMirror (ChatGPT) and Quill (Gemini): use native CDP `Input.insertText`, which operates at the browser engine level, preserving multi-line newlines without triggering premature form submission.

### Consequences
- 100% reliable input delivery across all supported web platforms.

---

## ADR-009: Background Tab Throttling Mitigation via CDP Focus Emulation

### Status
Accepted

### Context
Chromium throttles background tabs aggressively, causing 100ms timers to drift beyond 700ms and freezing WebSocket/SSE streams.

### Decision
Issue CDP commands prior to dispatch and during completion observation:
```json
Emulation.setFocusEmulationEnabled({ "enabled": true })
Page.setWebLifecycleState({ "state": "active" })
```

### Consequences
- Background tabs run at full foreground CPU priority with real-time SSE stream processing.

---

## ADR-010: Virtualized DOM Scroll-Chunk Traversal & Deduplication

### Status
Accepted

### Context
Modern web chat applications virtualize DOM turns, keeping only ~6 visible turns in memory for performance. Reading a 40-turn R&D thread without scroll-offset awareness results in incomplete history ingestion.

### Decision
`PlatformPort.readThread` traverses the virtualized container in smooth ascending chunks (`scrollTop`), harvesting turns into a Map keyed by canonical `turnKey` or content hash until the entire transcript is ingested.

### Consequences
- 100% transcript recovery on multi-hour architectural threads with zero missing historical turns.

---

## ADR-011: Resilient PID-Aware tmpfs Mutex Locking with Active Heartbeat Leases

### Status
Accepted (Revised Milestone 2)

### Context
Crashed processes can leave stale lock files on disk, deadlocking subsequent runs. Long generation runs could exceed standard lock TTLs if leases are not renewed.

### Decision
1. Lock files store `{"pid": number, "createdAt": number, "expiresAt": number, "targetId": string}`.
2. Default TTL aligned to 180 seconds (`DEFAULT_TTL_MS = 180_000`).
3. Active lease renewal heartbeat runs periodically every `ttlMs / 3` during prompt execution.
4. When encountering an existing lock:
   - Check if holding PID is alive via `process.kill(pid, 0)`.
   - If PID is dead or timestamp is expired, log `console.warn`, reclaim the lock, and proceed safely.

### Consequences
- Deadlock-free mutex locking across concurrent agent sessions.

---

## ADR-012: Capability-Driven Cross-Browser BiDi & CDP Decoupling

### Status
Accepted

### Context
Firefox implements W3C WebDriver BiDi; Chrome uses CDP. Tying `BrowserPort` to CDP internals prevented multi-browser execution.

### Decision
1. Decouple `BrowserPort` via `BrowserCapabilities` (`protocol: "cdp" | "webdriver-bidi"`).
2. Implement `FirefoxBidiAdapter` using W3C WebDriver BiDi primitives (`browsingContext.getTree`, `script.evaluate`, `input.performActions`).
3. Platform drivers receive `BrowserPort` and remain transport-agnostic.

### Consequences
- Side-by-side or interchangeable Chrome and Firefox execution.

---

## ADR-013: High-Fidelity Multi-Model Comparison & Staggered Dispatch

### Status
Accepted

### Context
Dispatching parallel queries across multiple models simultaneously over CDP can saturate browser IPC, drop frames, or cause lock contention. Platform timeouts must not discard surviving runs.

### Decision
1. **250ms Staggered Dispatch Offset:** Inserts 250ms delay between dispatches to avoid burst saturation.
2. **Failure Isolation:** Executes models via `Promise.allSettled`.
3. **Partitioned Storage:** Persists outputs in namespaced artifact trees (`./reports/<cmp-id>/artifacts/<platform>/<file>`).
4. **Deterministic Matrix:** Emits structured comparative metrics in `REPORT.md`.

### Consequences
- Robust, reliable multi-model benchmarking immune to single-platform failures.

---

## ADR-014: Two-Stage Technical Arbiter Consensus Engine

### Status
Accepted

### Context
Multi-model comparisons often produce conflicting architectural recommendations. Manually reviewing and reconciling 3 different outputs creates cognitive friction.

### Decision
1. **Stage 1 (Parallel Gathering):** Query candidate models (ChatGPT, Gemini, DeepSeek) in parallel.
2. **Stage 2 (Consensus Synthesis):** Package successful outputs into an arbitration brief and dispatch to a designated Arbiter (defaulting to DeepSeek R1).
3. Arbiter identifies flaws, extracts superior trade-offs, and outputs a single synthesized production specification. Expose via `--arbitrate` and `--arbiter`.

### Consequences
- Delivers unified consensus solutions from multi-model reasoning without per-token API charges.

---

## ADR-015: Durable SQLite Turn Ledger via `bun:sqlite` with FTS5 Search

### Status
Accepted

### Context
Agents need historical context survival across terminal restarts and instant search over past architectural trade-offs.

### Decision
1. Implements `ThreadStore` backed by `bun:sqlite` with WAL mode and FTS5 full-text indexing.
2. Store durable database at `$XDG_DATA_HOME/convolink/ledger.sqlite`.
3. Expose `convo search <query>`, `convo export <threadId>`, and `convo resume <threadId>`.

### Consequences
- High-speed full-text search with BM25 relevance ranking.
- Clean session resumption and markdown export.

---

## ADR-016: Non-Blocking Model Context Protocol (MCP) Server

### Status
Accepted (Revised Milestone 2)

### Context
Autonomous coding agents (Claude Desktop, Cursor, Antigravity) need native JSON-RPC 2.0 tool execution over `stdio`.

### Decision
1. Implement standard JSON-RPC 2.0 stdio server in `src/entrypoints/mcp.server.ts`.
2. Return null for un-id'd notifications to comply with JSON-RPC specifications.
3. Expose rich schemas for `convo_ask`, `convo_compare`, `convo_search`, `convo_export`, `convo_list_tabs`, `convo_tab_new`, `convo_tab_close`, and `convo_undo`.
4. Return structured execution results with `writtenFiles`, `riskLabels`, and `redactedSecretsCount`.

### Consequences
- Seamless IDE agent integration with zero `stdio` deadlocks.
