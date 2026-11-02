# browser-transport Specification

## Purpose
Provides a low-level, zero-overhead Chrome DevTools Protocol (CDP) transport abstraction to inspect and interact with running Chromium instances without terminating browser sessions or stealing operating system window focus.

## Requirements

### Requirement: CDP Connection and Health Discovery
The system SHALL discover and connect to an active Chromium browser over CDP across local loopback, dynamic ports, and virtualized host bridges without terminating sessions or corrupting user profiles.

#### Scenario: Successful connection to active browser
- **WHEN** client queries transport health against `127.0.0.1:9222`
- **THEN** system returns connection latency, adapter ID, and count of open target tabs

#### Scenario: Chrome instance unreachable
- **WHEN** port 9222 does not accept TCP connections on loopback
- **THEN** system returns structured error indicating port 9222 is closed with instructions to launch Chrome with `--remote-debugging-port=9222`

#### Scenario: WSL2 host gateway fallback
- **WHEN** running inside WSL2 and `127.0.0.1:9222` is closed
- **THEN** system automatically probes the Windows default gateway IP on port 9222 and connects to the host browser session

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

### Requirement: Container and Headless Compatibility
The system SHALL support headless cloud environments and containers by automatically applying container-safe execution flags.

#### Scenario: Execution without display server
- **WHEN** browser launch is requested on Linux with no `$DISPLAY` and no `$WAYLAND_DISPLAY`
- **THEN** system appends `--headless=new`, `--disable-gpu`, `--disable-dev-shm-usage`, and `--no-sandbox` to the process arguments

### Requirement: Native Protocol Event Dispatch and Stealth Preload
The system SHALL dispatch mouse and keyboard interactions across Chromium and Gecko engines using native protocol-level commands yielding `event.isTrusted: true` and SHALL inject preload scripts to mask browser automation artifacts before page scripts execute.

#### Scenario: Native protocol click dispatch
- **WHEN** client invokes click on a DOM selector via CDP or BiDi
- **THEN** system dispatches protocol-level pointer movements along a Bézier curve followed by native mouse down and mouse up events with `isTrusted: true`

#### Scenario: Automation indicator masking
- **WHEN** a new document or browsing context is initialized
- **THEN** system automatically injects preload scripts that scrub `navigator.webdriver`, stub standard `window.chrome` properties, and sanitize automation markers

