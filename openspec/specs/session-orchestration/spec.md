# session-orchestration Specification

## Purpose
Manages tab lifecycle discovery, concurrency locking via memory-backed tmpfs lockfiles, tab spawning/closing, and diagnostic command execution across connected browser targets.

## Requirements

### Requirement: PID-Aware tmpfs Mutex Locking
The system SHALL serialize access to active browser tabs using process-aware mutex lock files in memory-backed runtime storage.

#### Scenario: Acquiring uncontested tab lock
- **WHEN** client requests exclusive lock for a tab targetId
- **THEN** system writes JSON lockfile with owning PID and timestamp in `$XDG_RUNTIME_DIR/convolink/` and grants access

#### Scenario: Recovering from stale crashed lock
- **WHEN** existing lockfile exists but owning PID is no longer alive
- **THEN** system logs warning, reclaims lock, and proceeds without deadlocking

### Requirement: Diagnostic Doctor Inspection
The system SHALL provide a zero-mutation diagnostic command reporting open tabs, matched platform drivers, and DOM selector health.

#### Scenario: Running convo doctor
- **WHEN** user runs doctor command with Chrome open on port 9222
- **THEN** system prints structured diagnostic table listing target tabs, matched drivers, layout variants, and blocker states without altering browser state

### Requirement: Tab Lifecycle Management
The system SHALL support listing active tabs, spawning fresh background tabs, closing tabs cleanly, and undoing accidental navigations.

#### Scenario: Spawning and closing a tab
- **WHEN** client invokes `convo tab new deepseek` or `convo tab close <targetId>`
- **THEN** system opens or cleanly closes the designated tab without disturbing other active tabs
