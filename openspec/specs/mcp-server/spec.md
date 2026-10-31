# mcp-server Specification

## Purpose
Exposes ConvoLink's browser automation, model querying, comparison engine, and tab management capabilities through a standard JSON-RPC 2.0 Model Context Protocol (MCP) server over standard input/output (`stdio`).

## Requirements

### Requirement: JSON-RPC 2.0 Protocol Compliance
The system SHALL implement the MCP protocol over `stdio`, supporting `initialize`, `tools/list`, and `tools/call` without pauses or blocking interactive prompts.

#### Scenario: Agent handshake
- **WHEN** client sends `initialize` request with client info
- **THEN** system responds with protocol version `2024-11-05`, server metadata `convolink 0.2.0`, and tool capabilities

### Requirement: Cognitive Browser AI Tools
The system SHALL expose standardized tool schemas allowing MCP clients to query active tabs, trigger comparisons, spawn fresh tabs, and roll back state.

#### Scenario: Calling convo_ask via MCP
- **WHEN** client calls `convo_ask` with `{ "prompt": "Hello", "platform": "deepseek" }`
- **THEN** system routes the prompt to DeepSeek, acquires mutex lock, awaits response, persists to SQLite ledger, and returns the generated content and extracted code blocks
