# canvas-inspection Specification

## Purpose
Enables platform drivers to detect and extract full document state from secondary Canvas editors and side drawers when web models divert output away from the primary chat stream.

## Requirements

### Requirement: Canvas Container Detection
Platform drivers SHALL detect whether the active conversation session has an open Canvas editor or side-panel drawer.

#### Scenario: Active Canvas drawer present
- **WHEN** ChatGPT opens a Canvas workspace (`div[data-testid="canvas-editor"]` or `div.canvas-content`)
- **THEN** system flags session as Canvas-active and identifies the secondary editor DOM node

#### Scenario: Standard conversation without Canvas
- **WHEN** no Canvas editor drawer is present in the DOM
- **THEN** system resolves content extraction strictly through standard turn containers

### Requirement: Canvas Document State Extraction
The system SHALL extract the complete text content and language metadata from the Canvas editor without truncating unrendered lines.

#### Scenario: Extracting full Canvas document
- **WHEN** Canvas drawer is active upon generation completion
- **THEN** system extracts the entire editor content preserving linebreaks and indentation, returning it as the primary response artifact
