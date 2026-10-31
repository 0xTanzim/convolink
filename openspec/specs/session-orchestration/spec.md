# session-orchestration Specification

## Purpose
Manages tab lifecycle discovery, concurrency locking via memory-backed tmpfs lockfiles, and diagnostic command execution across connected browser targets.

## Requirements

### Requirement: PID-Aware tmpfs Mutex Locking
The system SHALL serialize access to active browser tabs using process-aware mutex lock files in memory-backed runtime storage.

#### Scenario: Acquiring uncontested tab lock
- **WHEN** client requests exclusive lock for a tab targetId
- **THEN** system writes JSON lockfile with owning PID and timestamp in `$XDG_RUNTIME_DIR/omni-bridge/` and grants access

#### Scenario: Recovering from stale crashed lock
- **WHEN** existing lockfile exists but owning PID is no longer alive
- **THEN** system logs warning, reclaims lock, and proceeds without deadlocking

### Requirement: Diagnostic Doctor Inspection
The system SHALL provide a zero-mutation diagnostic command reporting open tabs, matched platform drivers, and DOM selector health.

#### Scenario: Running omni doctor
- **WHEN** user runs doctor command with Chrome open on port 9222
- **THEN** system prints structured diagnostic table listing target tabs, matched drivers, layout variants, and blocker states without altering browser state
