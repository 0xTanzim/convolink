# artifact-extraction Specification

## Purpose
Provides automatic parsing, filepath detection, and filesystem persistence for code blocks, markdown documents, and structured artifacts emitted by web models during conversation turns.

## Requirements

### Requirement: Fenced Code Block File Discovery
The system SHALL parse all fenced code blocks in assistant responses and detect associated file paths from comment directives or header tags.

#### Scenario: Code block with explicit file path directive
- **WHEN** assistant response contains a fenced code block with `// filepath: src/index.ts` or `<!-- file: README.md -->`
- **THEN** system extracts the relative file path, content, and language tag into a structured artifact descriptor

#### Scenario: Code block without explicit file path directive
- **WHEN** assistant response contains an unannotated fenced code block
- **THEN** system generates a fallback filename based on turn index and language extension (e.g. `turn-1-code-0.ts`)

### Requirement: Workspace Artifact Persistence
The system SHALL support writing extracted artifacts to the local workspace with directory creation and overwrite safety.

#### Scenario: Writing artifacts to output directory
- **WHEN** client requests execution with `--write-files` and `--out-dir ./artifacts`
- **THEN** system creates necessary parent directories and writes the extracted artifacts to disk, returning a manifest of saved files
