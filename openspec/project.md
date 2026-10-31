# ConvoLink Project Context

## Overview
ConvoLink (`convolink` / `convo`) is an autonomous AI conversation runtime linking web models (ChatGPT, Claude, DeepSeek, Gemini) to local autonomous coding agents (Cursor, Claude Code, Antigravity) across Three Pillars.

## The Three Pillars
1. **Context Bridge**:
   - Append-only conversation ledger (`ThreadStore` backed by `bun:sqlite` with WAL mode).
   - High-speed full-text search (`convo search`, `convo_search` MCP tool).
   - Structured thread export (`convo export` in Markdown or JSON).
   - Session checkpointing and recovery (`convo history`, `convo undo`, `convo back`, `convo resume`).
2. **Intelligence Bridge**:
   - Live browser tab interaction (`convo ask`, `convo_ask` MCP tool) across ChatGPT, Claude, DeepSeek, and Gemini.
   - Zero OS focus theft via background tab execution (`Page.setWebLifecycleState: active`).
   - Multi-model benchmarking and parallel fan-out (`convo compare`, `convo_compare` MCP tool).
   - Stage 2 Technical Arbiter consensus synthesis (`--arbitrate --arbiter deepseek`).
   - Extended reasoning toggles (`--think`) and web search grounding (`--search`).
   - Tab lifecycle discovery and management (`convo doctor`, `convo list`, `convo tab new`, `convo tab close`).
3. **Capability Bridge**:
   - Multi-file code artifact extraction (`// filepath:`, `# filepath:`, `<!-- file: -->`) into workspace directories.
   - Directory traversal protection against unauthorized escape.
   - Canvas editor and side-drawer document extraction (`div[data-testid="canvas-editor"]`).
   - Authenticated in-browser sandbox binary downloads via CDP.
   - Automated multi-chunk stream continuation loops (clicking "Continue generating" up to 5 iterations).
   - 3-Signal streaming settling (action container, thinking transition, 400ms quiescence).

## Architectural Topology
- **Pure Domain Kernel (`src/core/`)**: Zero browser or transport imports. Maximum 200 lines per file.
- **Ports (`src/core/ports/`)**: Interfaces defining boundaries (`BrowserPort`, `PlatformPort`, `ThreadStore`, `WorkspaceSinkPort`, `PolicyGatePort`).
- **Adapters (`src/adapters/`)**:
  - `browsers/`: `RawCdpAdapter` (primary native CDP), `FirefoxBidiAdapter`, `AgentBrowserAdapter`.
  - `platforms/`: `ChatGPTDriver`, `ClaudeDriver`, `DeepSeekDriver`, `GeminiDriver`.
  - `storage/`: `SqliteLedgerStore`, `WorkspaceFileSinkAdapter`.
- **Entrypoints (`src/entrypoints/`)**:
  - `cli.ts`, `cli.args.ts`, `cli.ops.ts`, `cli.query.ts`, `cli.storage.ts`, `cli.help.ts`.
  - `mcp.server.ts`, `mcp.tools.ts`, `mcp.schema.ts`, `mcp.ts`.
