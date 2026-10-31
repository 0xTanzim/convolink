# browser-transport Specification

## Purpose
Provides a low-level, zero-overhead Chrome DevTools Protocol (CDP) transport abstraction to inspect and interact with running Chromium instances without terminating browser sessions or stealing operating system window focus.

## Requirements

### Requirement: CDP Connection and Health Discovery
The system SHALL discover and connect to an active Chromium browser over CDP on port 9222 without launching new browser windows or standalone user profiles.

#### Scenario: Successful connection to active browser
- **WHEN** client queries transport health against `127.0.0.1:9222`
- **THEN** system returns connection latency, adapter ID, and count of open target tabs

#### Scenario: Chrome instance unreachable
- **WHEN** port 9222 does not accept TCP connections
- **THEN** system returns structured error indicating port 9222 is closed with instructions to launch Chrome with `--remote-debugging-port=9222`

### Requirement: Safe Disconnect Semantics
The system SHALL disconnect cleanly by closing only the local WebSocket client connection and SHALL NEVER call `browser.close()` on the user's running browser.

#### Scenario: Disconnecting active session
- **WHEN** client calls session detach
- **THEN** local WebSocket connection terminates and the target browser tab remains open with all cookies and session state intact

### Requirement: Zero Focus Background Tab Execution
The system SHALL keep background browser tabs execution-active using CDP lifecycle emulation without stealing OS window focus from the user's active editor.

#### Scenario: Running background interaction
- **WHEN** system interacts with an inactive background tab
- **THEN** system enables CDP focus emulation and sets web lifecycle state to active without triggering window foreground popups
