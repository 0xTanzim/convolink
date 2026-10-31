# Project: ConvoLink Unified Engineering Audit & Improvement

## Architecture
ConvoLink is a hexagonal architecture (Ports and Adapters) continuity runtime connecting upstream web AI models (ChatGPT, Claude, DeepSeek, Gemini) to local autonomous coding agents (Cursor, Claude Code, Antigravity) across Three Pillars:
1. **Context Bridge**: Append-only conversation ledger (`ThreadStore` over SQLite FTS5), thread export (`convo export`), and searchable conversation history (`convo search`).
2. **Intelligence Bridge**: Live browser tab interaction (`convo ask`), parallel multi-model comparison (`convo compare`), Stage 2 Technical Arbiter consensus synthesis, and Deep Think / Web Search toggles.
3. **Capability Bridge**: Multi-file code artifact extraction (`// filepath:` extraction), canvas document inspection, in-browser authenticated file downloads, and stream continuation loops.

### Architecture Topology
- **Core Domain Kernel (`src/core/`)**: Pure TypeScript business domain. Strictly zero imports of browser automation or external infrastructure packages (`playwright`, `puppeteer`, `ws`, `agent-browser`).
- **Ports (`src/core/ports/`)**: Interfaces defining boundaries (`browser.port.ts`, `platform.port.ts`, `storage.port.ts`, `compiler.port.ts`, `policy.port.ts`).
- **Adapters (`src/adapters/`)**: Concrete infrastructure implementations:
  - `browsers/`: Native WebSocket CDP (`raw-cdp.adapter.ts`), WebDriver BiDi (`firefox-bidi.adapter.ts`), optional agent-browser.
  - `platforms/`: Web AI drivers (`chatgpt.driver.ts`, `claude.driver.ts`, `deepseek.driver.ts`, `gemini.driver.ts`).
  - `storage/`: SQLite ledger & FTS5 (`sqlite-ledger.adapter.ts`), workspace artifact sink (`workspace-sink.adapter.ts`).
- **Entrypoints (`src/entrypoints/`)**: CLI (`cli.ts`, `cli.args.ts`, `cli.ops.ts`) and Model Context Protocol stdio server (`mcp.server.ts`, `mcp.tools.ts`, `mcp.ts`).
- **Dependency Injection**: Root container in `src/container.ts` assembling all adapters and injecting them into domain services.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F01 | Path Traversal Defense | Verify containment in `WorkspaceFileSink` | M1 | Runtime/Sec Explorer (MAT-02) |
| F02 | Outbound Secret Scrubbing | Regexes for JWT (`eyJ`), AWS (`AKIA`), quoted `.env`, fix Git SHA collision | M1 | Runtime/Sec Explorer (MAT-03) |
| F03 | Core Port Duplication Cleanup | Remove duplicate `health()` and `listTabs()` in `browser.port.ts` | M1 | Arch/DX Explorer (F-03, D-P6-06) |
| F04 | Dead Import Removal | Remove unused `node:path` from `artifact.service.ts` | M1 | Arch Explorer (F-04) |
| F05 | Error Code Typing | Add `"ERR_PLATFORM_NOT_FOUND"` to `BridgeErrorCode` union | M1 | Arch Explorer (F-05) |
| F06 | Hexagonal Storage Sink | Extract `WorkspaceFileSink` to adapter with `WorkspaceSinkPort` in `src/core/ports/` | M1 | Arch Explorer (F-02) |
| F07 | Full IoC Container Wiring | Inject sub-services into `SessionOrchestrator` via `src/container.ts` | M1 | Arch Explorer (F-06) |
| F08 | Dead Code Pruning | Remove uncalled `protocol-detector.ts` | M1 | Arch Explorer (F-10) |
| F09 | 3-Signal Streaming Settling | Implement action container, thinking container, and 400ms quiescence window | M2 | Runtime Explorer (MAT-05, MAT-14) |
| F10 | Mutex Heartbeat & TTL Alignment | Lock lease renewal during prompts, 180s TTL, stale lock reclaim warning | M2 | Runtime Explorer (MAT-06, MAT-12) |
| F11 | MCP Stdio Readline Echo Fix | Remove `output: process.stdout` to prevent JSON-RPC stream corruption | M1 | Intel/MCP Explorer (D-P3-01) |
| F12 | JSON-RPC 2.0 Compliance | Return null on un-id'd notifications, eliminate `any` types, align version | M1 | Intel/MCP Explorer (D-P3-02, D-P6-07) |
| F13 | MCP Tool Schema & Metadata | Add `targetId`, `writeFiles`, `outDir` to `convo_ask`, return security/artifact metadata | M2 | Intel/MCP Explorer (MAT-04, D-P3-03) |
| F14 | CLI Argument Aliases | Support `-p`/`--platform`, `-t`/`--target`/`--targetId`, `-o`/`--out-dir` | M2 | DX Explorer (D-P6-04) |
| F15 | Symmetric Ledger Recording | Record user prompt turns alongside assistant turns in `ThreadStore` | M2 | Intel Explorer (D-P3-05) |
| F16 | Browser Transport Consolidation | Prune heavy `playwright` dependency, make native `RawCdpAdapter` primary | M2 | Arch/Critic Explorer (F-07, MAT-13) |
| F17 | Controller Granularity Ceilings | Refactor entrypoint handlers strictly under 120 lines | M2 | Intel Explorer (D-P3-07) |
| F18 | In-Memory Fake Storage & Core Tests | Implement `FakeThreadStore` and direct unit tests for core services | M2 | Testing Explorer (F-13, D-P7-02, D-P7-04) |
| F19 | Hermetic Integration Tests & Stale Tests | Fix `lock-service.test.ts` path and guard `cdp.test.ts` for offline CI | M2 | Testing Explorer (MAT-07, D-P7-01) |
| F20 | Strict TypeScript & modern Bun types | Upgrade `tsconfig.json` to `@types/bun` and strict index flags | M2 | Testing Explorer (D-P7-05) |
| F21 | Complete Markdown Docs Sync | Eliminate `omni` naming drift, synchronize ADRs 001-016, align 3 Pillars | M3 | DX Explorer (D-P6-01, D-P6-02, D-P6-05) |
| F22 | Multi-Layer Verification & 11 Deliverables | Run automated gates, challenger tests, auditor, compile 11 deliverables | M4 | All Explorers & Original Request R5 |

## Master Decision Matrix (Keep / Fix / Upgrade / Simplify / Remove / Build / Defer)
| ID | Component | Finding & Root Cause | Classification | Priority | Action Plan |
|:---|:---|:---|:---:|:---:|:---|
| **DM-01** | `src/core/` | Zero browser imports in pure domain kernel | **Keep** | Baseline | Maintain Zero-Import Isolation Law strictly. (VERIFIED) |
| **DM-02** | `src/core/services/workspace-sink.service.ts` | Direct `node:fs` calls without port abstraction and missing path traversal guard | **Fix** / **Upgrade** | P0 | Extracted to `src/adapters/storage/workspace-sink.adapter.ts` with `WorkspaceSinkPort`. Traversal guarded. (DONE) |
| **DM-03** | `src/core/services/policy.service.ts` | Missing JWT (`eyJ`), AWS (`AKIA`), unhandled quoted `.env`, 40-hex Git commit false-positive | **Fix** | P0 | Added regexes, lookahead for Git commit preservation, handled quotes. (DONE) |
| **DM-04** | `src/core/ports/browser.port.ts:40-44` | Verbatim duplicate declarations of `health()` and `listTabs()` | **Fix** | P0 | Removed duplicate declarations. (DONE) |
| **DM-05** | `src/core/services/artifact.service.ts:1` | Unused `import path from "node:path"` | **Remove** | P0 | Removed unused import. (DONE) |
| **DM-06** | `src/core/errors/bridge-errors.ts:112` | `PlatformDriverNotFoundError` defaults to `"ERR_GENERAL"` | **Fix** | P1 | Added `"ERR_PLATFORM_NOT_FOUND"` to `BridgeErrorCode`. (DONE) |
| **DM-07** | `src/core/services/orchestrator.ts:40,81` | Direct `new` instantiations of `TabManagerService` and `ComparisonCoordinator` | **Fix** | P1 | Injected via `src/container.ts` and `OrchestratorDependencies`. (DONE) |
| **DM-08** | `src/adapters/browsers/protocol-detector.ts` | `detectBrowserProtocol` is never called anywhere in `src/` | **Remove** | P1 | Deleted dead file `protocol-detector.ts` and its test. (DONE) |
| **DM-09** | Platform Drivers (`awaitCompletion`) | Drivers poll stop button and return immediately without thinking transition or 400ms quiescence | **Fix** / **Build** | P1 | Build shared `StreamSettlingDetector` enforcing action container, thinking state, and 400ms quiescence. |
| **DM-10** | `src/core/services/orchestrator.ts` & `lock.service.ts` | Lock lease not renewed during execution; TTL mismatch (120s vs 180s); silent reclaim | **Fix** | P1 | Maintain lock heartbeat during prompt; align TTL to 180s; log warning on stale lock reclamation. |
| **DM-11** | `src/entrypoints/mcp.ts:11` | `output: process.stdout` in readline causes stdout echo corrupting JSON-RPC | **Fix** | P0 | Removed `output: process.stdout`. (DONE) |
| **DM-12** | `src/entrypoints/mcp.server.ts` | Responding to notifications with error violates JSON-RPC 2.0; `any` types; version mismatch | **Fix** | P0 | Returns null on un-id'd notifications; typed interfaces; aligned version to 1.0.0. (DONE) |
| **DM-13** | `src/entrypoints/mcp.tools.ts` | `convo_ask` schema missing `targetId`, `writeFiles`, `outDir`; drops security risk metadata | **Upgrade** | P1 | Expose missing parameters; return structured object with `text`, `writtenFiles`, `riskLabels`. |
| **DM-14** | `src/entrypoints/cli.args.ts` | CLI argument parser does not recognize documented flags (`-p`, `-t`, `--targetId`, `-o`) | **Fix** | P1 | Support short and long flag aliases in argument parser. |
| **DM-15** | `src/core/services/orchestrator.ts:150-157` | `ask()` only records assistant turns to `ThreadStore`, dropping user prompt | **Fix** | P1 | Append user prompt turn followed by assistant response turn. |
| **DM-16** | `package.json` & `playwright.adapter.ts` | Heavy 50MB `playwright` dependency for CDP wrapper | **Simplify** / **Remove** | P2 | Prune `playwright` from dependencies; establish `RawCdpAdapter` as primary zero-dependency transport. |
| **DM-17** | `src/entrypoints/cli.*` & `mcp.tools.ts` | Entrypoint files exceed 120-line controller ceiling | **Simplify** | P2 | Refactor helper functions to keep all controllers under 120 lines. |
| **DM-18** | `tests/fakes/` & unit suites | Missing `FakeThreadStore` and direct unit tests for `TabResolver`, `DoctorService`, `ThreadExportService` | **Build** | P2 | Implement `FakeThreadStore` and comprehensive unit tests for core services. |
| **DM-19** | `tests/integration/cdp.test.ts` & `lock-service.test.ts` | Non-hermetic live Chrome reliance and wrong test lock directory `"omni-bridge"` | **Fix** | P1 | Probe port 9222 gracefully in integration tests; fix lock path to `"convolink"`. |
| **DM-20** | `tsconfig.json` | Obsolete `"bun-types"` and missing `"noUncheckedIndexedAccess": true` | **Upgrade** | P2 | Update `tsconfig.json` with `@types/bun` and strict index access. |
| **DM-21** | Tracked Markdown Docs | Pervasive `omni` naming drift, split ADRs (001-016), phantom components | **Fix** / **Upgrade** | P1 | Full documentation audit and synchronization across all `.md` files. |
| **DM-22** | `compiler.port.ts` & `.omni/CONTEXT.md` | Full context compiler snapshot engine | **Defer** | P3 | Maintain clean `compiler.port.ts` interface; defer multi-source compiler engine to future milestone. |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Core Domain Purity, Security Hardening & Protocol Fixes | F01 (Path Traversal), F02 (Secrets Regexes), F03 (Port Duplication), F04 (Dead Import), F05 (Error Code), F06 (WorkspaceSinkPort & Adapter), F07 (Container DI Wiring), F08 (Prune protocol-detector), F11 (MCP Readline Echo), F12 (JSON-RPC Notifications & Types) | none | DONE |
| M2 | Runtime Settling, Mutex Leases, Transport Simplification & Testing | F09 (3-Signal Settling), F10 (Lock Heartbeat & TTL), F13 (MCP Schema & Metadata), F14 (CLI Aliases), F15 (Symmetric Ledger), F16 (Consolidate Transport / Prune Playwright), F17 (Controllers <120 LOC), F18 (FakeThreadStore & Core Unit Tests), F19 (Hermetic Tests & Lock Test Path), F20 (tsconfig Strictness) | M1 | DONE |
| M3 | Full Markdown Documentation & Specification Sync | F21 (Eliminate omni drift, ADRs 001-016 consolidation, remove orphaned bin/omni-bridge.ts, align 3 Pillars across all .md files) | M2 | DONE |
| M4 | Independent Multi-Layer Verification & 11 Deliverables Compilation | F22 (Automated Gates, Reviewers, Challenger, Forensic Integrity Audit, 11 Deliverables Compilation) | M3 | DONE |

## Interface Contracts
### `WorkspaceSinkPort` (`src/core/ports/storage.port.ts`)
```typescript
export interface PersistOptions {
  outDir: string;
  overwrite?: boolean;
}
export interface PersistResult {
  writtenFiles: readonly WrittenFileRecord[];
  skippedFiles: readonly SkippedFileRecord[];
}
export interface WorkspaceSinkPort {
  persist(artifacts: readonly CodeArtifact[], options: PersistOptions): Promise<PersistResult>;
}
```

### `StreamSettlingDetector` (`src/adapters/platforms/settling-detector.ts`)
```typescript
export interface SettlingOptions {
  isGenerating: boolean;
  isThinking?: boolean;
  contentLength: number;
  quiescenceMs?: number; // default 400ms
}
```

### `OrchestratorDependencies` (`src/core/services/orchestrator.ts`)
```typescript
export interface OrchestratorDependencies {
  browser: BrowserPort;
  drivers: readonly PlatformPort[];
  lockService: LockService;
  policyGate: PolicyGatePort;
  artifactService?: ArtifactService;
  fileSink?: WorkspaceSinkPort;
  journalService?: StateJournalService;
  threadStore?: ThreadStore;
  tabManager?: TabManagerService;
  comparisonCoordinator?: ComparisonCoordinator;
}
```

## Code Layout
- `src/core/`: Zero browser or transport imports. Max 200 lines/file, max 80 lines/function.
- `src/adapters/`:
  - `browsers/raw-cdp.adapter.ts`: Primary native WebSocket CDP transport.
  - `storage/workspace-sink.adapter.ts`: Secure filesystem artifact persistence.
  - `platforms/`: Platform drivers with 3-signal streaming settling.
- `src/entrypoints/`: CLI and MCP handlers, strictly <= 120 lines/file.
- `tests/fakes/`: Complete in-memory test doubles (`FakeBrowserPort`, `FakeThreadStore`, `FakePlatformPort`).
- `docs/`: Unified `docs/ADR.md` (ADR-001 to ADR-016), `docs/ARCHITECTURE.md`, `docs/PROJECT_BRIEF.md`.
