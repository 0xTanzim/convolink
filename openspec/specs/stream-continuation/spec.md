# stream-continuation Specification

## Purpose
Enables automated detection of model token truncation events and triggers continuation actions to stitch fragmented responses into a single complete output.

## Requirements

### Requirement: Truncation Button Detection
The system SHALL identify when an assistant generation has halted prematurely with an active continuation trigger.

#### Scenario: Turn halted with Continue button
- **WHEN** model stream ceases but a `"Continue generating"` or continuation button is visible in the active turn container
- **THEN** system flags the turn as truncated and identifies the continuation click target

### Requirement: Seamless Turn Concatenation
The system SHALL dispatch the continuation trigger and append subsequent content chunks into a unified markdown response.

#### Scenario: Automatic continuation loop
- **WHEN** continuation button is detected and `--no-continue` flag is not set
- **THEN** system clicks continuation button, awaits stream settling for the subsequent chunk, and merges code blocks and markdown without duplicated text
