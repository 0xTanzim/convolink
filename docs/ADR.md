# Architecture Decision Records (ADRs)

## ADR-012: Capability-Driven Cross-Browser BiDi & CDP Decoupling

### Status
Accepted

### Date
2026-10-31

### Context
ConvoLink was initially authored to bridge coding terminal agents with authenticated Chromium tabs (Chrome, Edge, Brave, Chromium) via the Chrome DevTools Protocol (CDP).

However, modern browser automation has diverged across browser engines:
1. **Chromium Family (Chrome, Edge, Brave, Opera):** Uses Chrome DevTools Protocol (CDP) WebSocket sessions with `/json/list`, `/json/new`, and `/json/close`.
2. **Mozilla Firefox:** Implements the official W3C WebDriver BiDi (Bidirectional) protocol over WebSocket. Firefox does not offer standard production-grade CDP support for tab management, preferring standard BiDi primitives (`session.new`, `browsingContext.*`, `script.evaluate`, `input.performActions`).
3. **Safari / WebKit:** Leverages WebDriver protocol specifications.

Tying `BrowserPort` to CDP-specific internals (e.g. assumptions around `targetId` and `Page.setWebLifecycleState`) created tight coupling that prevented multi-browser execution.

### Decision
1. **De-couple `BrowserPort` via `BrowserCapabilities`:**
   Expose explicit runtime capabilities on every browser adapter:
   - `protocol: "cdp" | "webdriver-bidi"`
   - `browserFamily: "chromium" | "firefox" | "webkit" | "unknown"`
   - `supportsBackgroundLifecycle: boolean`
   - `supportsFileDownloads: boolean`
   - `supportsTabManagement: boolean`

2. **Decouple Platform Drivers from Browser Transports:**
   Platform drivers (`ChatGPTDriver`, `DeepSeekDriver`, `GeminiDriver`) receive `BrowserPort` and are completely agnostic of whether the underlying transport is Chromium CDP, `agent-browser`, or Firefox WebDriver BiDi. Drivers only care about DOM selectors and JavaScript execution semantics.

3. **Introduce `FirefoxBidiAdapter`:**
   Implement `BrowserPort` using standard W3C WebDriver BiDi commands:
   - Tab discovery via `browsingContext.getTree`.
   - Tab lifecycle via `browsingContext.create` and `browsingContext.close`.
   - JavaScript execution via `script.evaluate`.
   - Input simulation via `input.performActions`.

4. **Dynamic Protocol Probing:**
   Expose protocol detection utility to probe the target listening port (`http://127.0.0.1:<port>/json/version` vs BiDi WebSocket handshake) to allow zero-configuration multi-browser detection.

### Consequences
- ConvoLink can control Chrome and Firefox side-by-side or interchangeably.
- Clean Hexagonal separation is preserved: zero browser dependencies in `src/core/`.
- All adapters satisfy the exact same `BrowserPort` contract with 100% test coverage.

---

## ADR-013: High-Fidelity Multi-Model Comparison & Staggered Dispatch

### Status
Accepted

### Date
2026-10-31

### Context
Developers frequently ask the same complex prompt across ChatGPT, DeepSeek, and Gemini to evaluate differing trade-offs, code styles, and reasoning quality. Manually dispatching prompts across 3 browser tabs is slow and error-prone. Naive parallel dispatch over WebSocket CDP can saturate browser process IPC and cause frame drops or lock contention. Furthermore, if one platform encounters a CAPTCHA or times out, the other models' responses should not be discarded.

### Decision
1. **Parallel Bounded Dispatch with Staggered Offsets:** Dispatch model prompts across targets in parallel, but insert a 250ms offset between prompts to prevent concurrent input race conditions and WebSocket burst saturation.
2. **Failure Isolation via `Promise.allSettled`:** Treat each platform as an isolated failure domain. If platform A fails or times out, platforms B and C proceed to completion.
3. **Namespaced Artifact Partitioning:** Write generated files to `./reports/<cmp-id>/artifacts/<platform>/<file>`, preventing conflicting file overwrites between models.
4. **Deterministic Comparison Matrix:** Compute exact metrics (elapsed time, character count, code blocks, lines of code) and emit structured Markdown reports (`REPORT.md`).

### Consequences
- Comparison operations are fast, reliable, and immune to single-platform failures.
- Zero race conditions on browser tab event loops.

---

## ADR-014: Two-Stage Technical Arbiter Consensus Engine

### Status
Accepted

### Date
2026-10-31

### Context
When comparing multiple models, users often encounter contradictory recommendations or subtle bugs in one model's output that another model solved correctly. Requiring the developer to manually review and merge 3 complete implementations defeats the purpose of autonomous acceleration.

### Decision
1. **Two-Stage Pipeline:**
   - **Stage 1 (Parallel Candidate Gathering):** Query candidate models (e.g. ChatGPT, Gemini, DeepSeek) in parallel.
   - **Stage 2 (Consensus Synthesis):** Filter out failed runs and package all successful candidate outputs into an arbitration brief. Dispatch this brief to a designated Technical Arbiter (defaulting to deep reasoning models like DeepSeek R1).
2. **Arbiter Prompt Contract:**
   The prompt instructs the arbiter to:
   - Identify logical flaws, security bugs, and performance bottlenecks across candidates.
   - Extract the superior architectural decisions.
   - Deliver the definitive, unified production implementation.
3. **CLI & MCP Surface:** Expose `--arbitrate` and `--arbiter <platform>` flags on `convo compare` and in the MCP tool schema.

### Consequences
- Delivers a single, battle-tested consensus solution synthesized from multi-model reasoning.
- Operates entirely within active web browser sessions with zero API token consumption.

---

## ADR-015: Durable SQLite Turn Ledger via `bun:sqlite`

### Status
Accepted

### Date
2026-10-31

### Context
Previously, ConvoLink stored context in memory or transient markdown checkpoints. If the terminal session terminated, conversation context and code blocks were lost. Moreover, agents need to be able to export historical threads as documentation or resume existing conversations by thread ID.

### Decision
1. **Native Bun SQLite:** Use `bun:sqlite` with Write-Ahead Logging (WAL) and foreign keys enabled. Zero external npm dependencies.
2. **Hexagonal Persistence Port (`ThreadStore`):** Define pure storage port in `src/core/ports/storage.port.ts`. Production implementation in `src/adapters/storage/sqlite-ledger.adapter.ts`. In-memory `FakeThreadStore` used for unit testing.
3. **XDG Standard Path:** Store durable database at `$XDG_DATA_HOME/convolink/ledger.sqlite` (`~/.local/share/convolink/ledger.sqlite`).
4. **Granularity Ceilings:** Extract `ThreadExportService` and `TabResolver` to ensure every source file remains under 200 lines.
5. **CLI Subcommands:** Add `convo export <threadId> [--format md|json]` and `convo resume <threadId>`.

### Consequences
- Full conversation history and code blocks survive restarts and crashes.
- Seamless thread resumption and markdown report export.

---

## ADR-016: Non-Blocking Model Context Protocol (MCP) Server

### Status
Accepted

### Date
2026-10-31

### Context
Autonomous coding agents (Claude Desktop, Cursor, Antigravity, OpenCode, Windsurf) need programmatic access to browser AI sessions without executing ad-hoc shell commands or managing CLI output formatting.

### Decision
1. **JSON-RPC 2.0 over `stdio`:** Implement standard MCP protocol handling `initialize`, `tools/list`, and `tools/call`.
2. **Strict Architecture Separation:**
   - Protocol parser & dispatcher: `src/entrypoints/mcp.server.ts` (<100 LOC)
   - Cognitive tool definitions & handlers: `src/entrypoints/mcp.tools.ts` (<150 LOC)
   - Standard I/O runner: `src/entrypoints/mcp.ts` (<50 LOC)
   - Standalone binary: `bin/convolink-mcp.ts` (4 LOC)
3. **Tool Surface:** Expose `convo_ask`, `convo_compare`, `convo_list_tabs`, `convo_tab_new`, `convo_tab_close`, and `convo_undo`.
4. **Non-Blocking Invariants:** The MCP server never pauses `stdio` or requests interactive user input, preventing agent deadlocks.

### Consequences
- Any standard MCP client can plug into ConvoLink directly.
- Full parity between CLI commands and agent MCP tools.
