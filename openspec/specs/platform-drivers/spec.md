# platform-drivers Specification

## Purpose
Provides platform-specific DOM adapters for web AI interfaces (ChatGPT, Claude, DeepSeek, Gemini) handling reactive input injection, code indentation preservation, and 3-signal streaming completion.

## Requirements

### Requirement: Reactive Input Injection
The system SHALL inject text into target AI web composers using platform-appropriate reactive mechanisms to avoid silent input drops.

#### Scenario: DeepSeek prompt injection
- **WHEN** user sends prompt to DeepSeek
- **THEN** system invokes HTMLTextAreaElement prototype value setter and dispatches bubbling input event, enabling the send button

#### Scenario: ChatGPT ProseMirror prompt injection
- **WHEN** user sends prompt to modern ChatGPT
- **THEN** system targets `div.ProseMirror[contenteditable="true"]` using native text insertion without breaking multi-line markdown newlines

#### Scenario: Claude prompt injection
- **WHEN** user sends prompt to Claude
- **THEN** system targets contenteditable composer container and triggers send button click

#### Scenario: Gemini Quill prompt injection
- **WHEN** user sends prompt to Gemini
- **THEN** system targets `rich-textarea div.ql-editor` and triggers dynamic send message button click

### Requirement: Code Indentation Fidelity
The system SHALL extract conversation turns while preserving 100% of indentation whitespace and code block formatting.

#### Scenario: Code block extraction
- **WHEN** assistant response contains fenced code blocks inside `<pre><code>`
- **THEN** system extracts text using textContent, preserving leading spaces and tabs without capturing UI button text

### Requirement: 3-Signal Streaming Completion Detection
The system SHALL determine generation completion by verifying action container idle state (absence of stop button or spinner), thinking container settling, and a minimum 400ms window of DOM mutation quiescence.

#### Scenario: Reasoning model pauses silently
- **WHEN** model enters silent thinking phase where text growth pauses but SVG gradient spinner remains active
- **THEN** system maintains wait state and does not declare completion prematurely
