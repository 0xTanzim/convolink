# Architecture Decision Records (ADRs)

## ADR-012: Capability-Driven Cross-Browser BiDi & CDP Decoupling

### Status
Accepted

### Date
2026-10-31

### Context
ConvoLink was initially authored to bridge coding terminal agents with authenticated Chromium tabs (Chrome, Edge, Brave, Chromium) via the Chrome DevTools Protocol (CDP).

However, modern browser automation has diverged across browser engines:
1. **Chromium Family (Chrome, Edge, Brave, Opera):** Uses Chrome DevTools Protocol (CDP) WebSocket sessions with `/json/list`, `/json/new`, and `/json/close`.
2. **Mozilla Firefox:** Implements the official W3C WebDriver BiDi (Bidirectional) protocol over WebSocket. Firefox does not offer standard production-grade CDP support for tab management, preferring standard BiDi primitives (`session.new`, `browsingContext.*`, `script.evaluate`, `input.performActions`).
3. **Safari / WebKit:** Leverages WebDriver protocol specifications.

Tying `BrowserPort` to CDP-specific internals (e.g. assumptions around `targetId` and `Page.setWebLifecycleState`) created tight coupling that prevented multi-browser execution.

### Decision
1. **De-couple `BrowserPort` via `BrowserCapabilities`:**
   Expose explicit runtime capabilities on every browser adapter:
   - `protocol: "cdp" | "webdriver-bidi"`
   - `browserFamily: "chromium" | "firefox" | "webkit" | "unknown"`
   - `supportsBackgroundLifecycle: boolean`
   - `supportsFileDownloads: boolean`
   - `supportsTabManagement: boolean`

2. **Decouple Platform Drivers from Browser Transports:**
   Platform drivers (`ChatGPTDriver`, `DeepSeekDriver`, `GeminiDriver`) receive `BrowserPort` and are completely agnostic of whether the underlying transport is Chromium CDP, `agent-browser`, or Firefox WebDriver BiDi. Drivers only care about DOM selectors and JavaScript execution semantics.

3. **Introduce `FirefoxBidiAdapter`:**
   Implement `BrowserPort` using standard W3C WebDriver BiDi commands:
   - Tab discovery via `browsingContext.getTree`.
   - Tab lifecycle via `browsingContext.create` and `browsingContext.close`.
   - JavaScript execution via `script.evaluate`.
   - Input simulation via `input.performActions`.

4. **Dynamic Protocol Probing:**
   Expose protocol detection utility to probe the target listening port (`http://127.0.0.1:<port>/json/version` vs BiDi WebSocket handshake) to allow zero-configuration multi-browser detection.

### Consequences
- ConvoLink can control Chrome and Firefox side-by-side or interchangeably.
- Clean Hexagonal separation is preserved: zero browser dependencies in `src/core/`.
- All adapters satisfy the exact same `BrowserPort` contract with 100% test coverage.
