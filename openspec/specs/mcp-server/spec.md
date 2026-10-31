# mcp-server Specification

## Purpose
Exposes ConvoLink's browser automation, model querying, comparison engine, turn ledger search, and tab management capabilities through a standard JSON-RPC 2.0 Model Context Protocol (MCP) server over standard input/output (`stdio`).

## Requirements

### Requirement: JSON-RPC 2.0 Protocol Compliance
The system SHALL implement the MCP protocol over `stdio`, supporting `initialize`, `tools/list`, and `tools/call` without pauses, echo corruption, or blocking interactive prompts.

#### Scenario: Agent handshake
- **WHEN** client sends `initialize` request with client info
- **THEN** system responds with protocol version `2024-11-05`, server metadata `convolink 1.0.0`, and tool capabilities

### Requirement: Cognitive Browser AI Tools
The system SHALL expose standardized tool schemas allowing MCP clients to query active tabs, trigger comparisons, spawn fresh tabs, search historical turns, export ledgers, and roll back state across 8 discrete tools.

#### Scenario: Calling convo_ask via MCP
- **WHEN** client calls `convo_ask` with `{ "prompt": "Hello", "platform": "deepseek", "writeFiles": true, "outDir": "./src" }`
- **THEN** system routes the prompt to DeepSeek, acquires mutex lock, awaits response, extracts artifacts, persists to SQLite ledger, and returns structured result with `text`, `writtenFiles`, `riskLabels`, and `redactedSecretsCount`

#### Scenario: Calling convo_compare via MCP
- **WHEN** client calls `convo_compare` with `{ "prompt": "Benchmark", "arbitrate": true }`
- **THEN** system fans out prompt to candidate platforms and returns synthesized consensus report

#### Scenario: Calling convo_search and convo_export via MCP
- **WHEN** client queries `convo_search` or exports thread via `convo_export`
- **THEN** system queries SQLite FTS5 index and returns matched snippets or serialized thread history
