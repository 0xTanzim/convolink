# multi-model-comparison Specification

## Purpose
Enables concurrent querying of multiple web AI platforms (ChatGPT, DeepSeek, Gemini) with staggered dispatch, partial failure domain isolation, automated benchmark metrics, and optional two-stage consensus synthesis via a Technical Arbiter.

## Requirements

### Requirement: Parallel Staggered Dispatch
The system SHALL query multiple AI platform tabs in parallel with a staggered dispatch offset to avoid WebSocket frame saturation and event loop contention.

#### Scenario: Comparing across three platforms
- **WHEN** client runs `convo compare` targeting ChatGPT, DeepSeek, and Gemini
- **THEN** system dispatches the prompt with a 250ms offset between tabs and awaits completions concurrently

### Requirement: Failure Domain Isolation
The system SHALL isolate individual platform failures using settled promise semantics so that timeouts or CAPTCHAs on one platform do not abort the execution or metrics of healthy models.

#### Scenario: One platform times out
- **WHEN** DeepSeek completes in 18s but Gemini times out
- **THEN** comparison engine records DeepSeek as successful, Gemini as failed, and emits the benchmark matrix for all completed runs

### Requirement: Two-Stage Technical Arbiter Consensus
The system SHALL support an optional Stage 2 arbitration pass that collects candidate implementations from Stage 1, packages them into an arbitration brief, and dispatches them to a designated reasoning model.

#### Scenario: Generating unified consensus code
- **WHEN** client passes `--arbitrate --arbiter deepseek`
- **THEN** system gathers successful Stage 1 answers, formats a structured arbiter prompt highlighting strengths and flaws, and returns the arbiter's synthesized production code
