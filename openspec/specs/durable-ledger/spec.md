# durable-ledger Specification

## Purpose
Provides a persistent, zero-dependency local turn ledger backed by `bun:sqlite` to durably store conversation threads, assistant outputs, extracted code blocks, and context packets across CLI runs and system reboots.

## Requirements

### Requirement: Immutable SQLite Turn Storage
The system SHALL persist all conversation prompts and assistant completions in an append-only SQLite ledger using Write-Ahead Logging (WAL) mode.

#### Scenario: Appending turn during ask
- **WHEN** client executes `convo ask` to a platform tab
- **THEN** system upserts the thread entry and records the user prompt and assistant response with exact code blocks preserved in `$XDG_DATA_HOME/convolink/ledger.sqlite`

### Requirement: Thread Exporting
The system SHALL export recorded conversation turns as formatted Markdown or structured JSON context packets.

#### Scenario: Exporting thread as Markdown
- **WHEN** client runs `convo export <threadId> --format md`
- **THEN** system queries all recorded turns in ascending order and emits a formatted conversation ledger

### Requirement: Thread Resumption
The system SHALL support restoring an existing conversation session by navigating the browser to the thread's recorded URL.

#### Scenario: Resuming historical conversation
- **WHEN** client runs `convo resume <threadId>`
- **THEN** system locates the thread URL in the ledger and re-attaches or navigates to the tab
