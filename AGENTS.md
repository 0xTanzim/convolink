# AGENTS.md — ConvoLink Engineering Standards & Operational Laws

**Project:** ConvoLink (`agent-conversation` continuity runtime)  
**Target Environment:** Fedora Linux (primary, `XDG` + `tmpfs`), macOS, Windows  
**Runtime & Tooling:** TypeScript 7+ (Strict ESM), Bun runtime, `bun:test` native runner, Biome / ESLint  
**Architectural Paradigm:** Hexagonal Architecture (Ports and Adapters) with Strict Inversion of Control (IoC)

---

## 1. Architectural Core Principles

Every contributor and AI agent operating in this repository MUST abide by the following foundational architectural mandates. Violations will result in rejected pull requests.

### 1.1 The Zero-Import Isolation Law of `src/core/`
- **Absolute Boundary:** No file within `src/core/` is permitted to import any browser automation framework or network transport library. This includes, but is not limited to: `playwright`, `puppeteer`, `ws`, `agent-browser`, `puppeteer-core`, or `@playwright/test`.
- **Pure Domain Kernel:** `src/core/` consists exclusively of pure business domain entities, services, use-cases, value objects, and abstract Port interfaces.
- **Port Abstraction:** Any interaction with an external system (Chromium instance, filesystem, operating system, or database) MUST be abstracted behind an interface defined in `src/core/ports/`.

### 1.2 Hexagonal Architecture & Dependency Injection (DI)
- Inbound adapters (`src/entrypoints/cli.ts`, `src/entrypoints/mcp.ts`) invoke use-cases declared in `src/core/services/`.
- `src/core/` communicates with infrastructure exclusively via outbound ports (`BrowserPort`, `PlatformPort`, `ThreadStore`, `ContextCompilerPort`, `PolicyGatePort`).
- Concrete infrastructure implementations live exclusively within `src/adapters/` and are resolved at application entrypoints via `src/container.ts`. No service may instantiate its own concrete dependencies.

### 1.3 State Decoupling & Thread Portability
- The browser tab is **elastic, transient compute**, NOT the durable source of truth.
- Durable state resides in the append-only ledger (`ThreadStore`) and compiled snapshots (`.omni/CONTEXT.md`). If a browser tab crashes or is closed, the session state MUST survive and be rehydratable into a new tab via `rollover()`.

---

## 2. Code Standards & Structural Quality

### 2.1 Runtime & Module Constraints
- **Target Runtime:** Bun (`bun >= 1.2.0`). All modules MUST compile with strict ESM semantics (`import`/`export` with explicit `.js` extensions in emitted artifacts).
- **TypeScript Strictness:** `"strict": true`, `"noImplicitAny": true`, `"exactOptionalPropertyTypes": true`, `"noUncheckedIndexedAccess": true`. Never use `any` unless wrapping low-level un-typed CDP protocol payloads; even then, cast immediately to an explicit interface.

### 2.2 Strict Granularity & Line Limits
Code bloat hides bugs and reduces reasoning clarity. Adhere to these mechanical limits:
- **Core Modules / Services:** Maximum **200 lines of code** per file. If a service exceeds 200 lines, extract cohesive sub-domains or helper primitives.
- **Handlers, Adapters & Driver Methods:** Maximum **80 lines of code** per function/handler.
- **Cyclomatic Complexity:** Maximum nesting depth of **3 levels**. Enforce guard clauses and **early returns**.
- **No Side Effects in Pure Services:** Domain functions must be deterministic and pure whenever possible. Asynchronous operations and I/O are strictly reserved for adapter implementations or explicit service orchestrators.

---

## 3. Test-Driven Development (TDD) Iron Law

No production code may be authored unless preceded by an automated test that fails for the expected reason.

### 3.1 The 5-Step TDD Loop
1. **RED:** Write a minimal test specifying the desired behavior in a corresponding `*.test.ts` file.
2. **VERIFY RED:** Execute `bun test <path-to-test>`. Confirm the test fails specifically due to the missing implementation, not due to syntax or environmental errors.
3. **GREEN:** Write the minimal amount of production code required to make the test pass.
4. **VERIFY GREEN:** Execute `bun test`. Confirm all tests pass with zero regressions.
5. **REFACTOR:** Clean up code structure, enforce line limits, and optimize performance while maintaining passing tests.

### 3.2 Testing Boundaries
- **Unit Tests (`tests/unit/`):** Test `src/core/` entities, services, and compilation logic using pure in-memory test doubles (`FakeBrowserPort`, `FakeThreadStore`). Unit test suites must execute in `< 100ms` and require zero external daemons or network listeners.
- **Integration Tests (`tests/integration/`):** Test adapters against either deterministic CDP mock WebSocket servers or an active local Chrome session on `127.0.0.1:9222`.
- **E2E / CLI Tests (`tests/e2e/`):** Validate end-to-end CLI commands (`omni doctor`, `omni sync`, `omni ask`) via subprocess execution under controlled environments.

---

## 4. Operational & Security Guardrails

### 4.1 Non-Blocking `PolicyGate`
- **Outbound Secret Scrubbing:** Every outbound prompt string must pass through `PolicyGatePort.sanitizeOutboundPrompt()`. Known API key patterns (`sk-[a-zA-Z0-9_-]{20,}`, `ghp_[a-zA-Z0-9]{36}`, AWS secrets, generic JWTs, and `.env` variable assignments) must be redacted to `[REDACTED_SECRET]` before transmission.
- **Non-Blocking Inbound Tagging:** Inspect incoming model responses for risky commands (e.g., `rm -rf`, `sudo`, destructive disk writes). Tag the payload with `contains_destructive_command: true` in the metadata. **NEVER pause or halt `stdin` / `stdio`** to request confirmation within the MCP or CLI pipeline; halting deadlocks the parent coding agent. Leave execution authorization to the executor's native approval model.

### 4.2 PID-Aware `tmpfs` Mutex Locking
- **Lock Directory:** On Linux, use `$XDG_RUNTIME_DIR/convolink/` (`/run/user/<UID>/convolink/`). This resides in RAM (`tmpfs`), preventing SSD wear and eliminating stale locks on system reboot.
- **Lock File Format:** `tab-<targetId>.lock`.
- **Deadlock & Stale Lock Prevention:**
  - The lock file MUST contain `{"pid": <PID>, "targetId": "<UUID>", "acquiredAt": "<ISO-DATE>"}`.
  - Before failing on an existing lock, the acquiring process MUST check if the holding PID is still alive via `process.kill(pid, 0)`.
  - If the process is dead, or if the lock has been held beyond the TTL (default: 180 seconds without a heartbeat), the stale lock MUST be automatically reclaimed and a warning logged.

### 4.3 Safe Browser Detach Semantics
- **No Process Termination:** Calling `browser.close()` on a live user browser is classified as a Critical Severity Bug.
- **Clean Disconnect:** When tearing down a session, adapters MUST ONLY call `browser.disconnect()` or close the local WebSocket client. The user's browser, windows, tabs, and login cookies MUST remain intact.

### 4.4 Zero Window-Focus Theft
- **No `bringToFront()` by Default:** Never interrupt the developer while they are typing in another application.
- **CDP Background Wake:** Use CDP commands to defeat background tab throttling silently without stealing OS focus:
  ```typescript
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await cdp.send("Page.setWebLifecycleState", { state: "active" });
  ```
- **Exception:** `bringToFront()` is ONLY permitted when an interactive CAPTCHA, Cloudflare verification, or authentication challenge is detected that requires manual human intervention.

### 4.5 DOM Mutation & Streaming Settling
Never rely solely on text length stabilization (DTVA) to detect stream completion. Completion requires all three signals:
1. Action container state (stop button / loading spinner absent).
2. Thinking container transition (collapsible details closed / static).
3. Quiescence window: zero DOM mutations or network stream frames for at least 400ms.

---

## 5. Repository Directory Layout

```text
convolink/
├── .github/                       # CI/CD Workflows (lint, typecheck, unit tests)
├── docs/                          # Architectural documentation
│   ├── ARCHITECTURE.md            # Hexagonal topology & contracts
│   ├── ADR.md                     # Architecture Decision Records (ADR-001 to ADR-016)
│   └── PROJECT_BRIEF.md           # Product requirements & problem statement
├── scripts/
│   └── fedora-chrome-debug.sh     # Native helper to launch/verify Chrome on port 9222
├── src/
│   ├── core/                      # PURE DOMAIN KERNEL (ZERO BROWSER IMPORTS)
│   │   ├── env/                   # OS / XDG path resolution
│   │   │   └── host-env.ts
│   │   ├── ports/                 # Interfaces defining boundaries
│   │   │   ├── browser.port.ts
│   │   │   ├── platform.port.ts
│   │   │   ├── storage.port.ts
│   │   │   ├── compiler.port.ts
│   │   │   └── policy.port.ts
│   │   ├── services/              # Pure domain services
│   │   │   ├── orchestrator.ts
│   │   │   ├── comparison-engine.ts
│   │   │   ├── tab-resolver.ts
│   │   │   ├── thread-export.service.ts
│   │   │   ├── lock.service.ts
│   │   │   └── policy.service.ts
│   │   └── errors/                # Strongly-typed domain error classes
│   │       └── bridge-errors.ts
│   ├── adapters/                  # INFRASTRUCTURE IMPLEMENTATIONS
│   │   ├── browsers/              # Transports (Raw CDP, Firefox BiDi, Playwright, agent-browser)
│   │   │   ├── raw-cdp.adapter.ts
│   │   │   ├── firefox-bidi.adapter.ts
│   │   │   ├── playwright.adapter.ts
│   │   │   └── agent-browser.adapter.ts
│   │   ├── platforms/             # Platform drivers (DeepSeek, ChatGPT, Gemini)
│   │   │   ├── deepseek.driver.ts
│   │   │   ├── chatgpt.driver.ts
│   │   │   └── gemini.driver.ts
│   │   └── storage/               # Persistence adapters
│   │       ├── sqlite-ledger.adapter.ts
│   │       └── workspace-md.adapter.ts
│   ├── entrypoints/               # INBOUND INTERFACES
│   │   ├── cli.ts                 # CLI commands (doctor, ask, compare, export, resume, mcp)
│   │   ├── mcp.server.ts          # Model Context Protocol stdio server
│   │   ├── mcp.tools.ts           # Cognitive browser tool schemas
│   │   └── mcp.ts                 # MCP stdio runner
│   └── container.ts               # Dependency Injection assembly
├── tests/
│   ├── unit/                      # Fast in-memory pure domain tests
│   ├── integration/               # Adapter & CDP protocol tests
│   └── fakes/                     # In-memory test doubles for ports
├── AGENTS.md                      # Operational and behavioral laws (this file)
├── package.json
└── tsconfig.json
```

---

## 6. Definition of Done (DoD)

A task or pull request is strictly incomplete until all of the following criteria are met:
1. **Test-First Provenance:** Every new function, branch, or bugfix has an accompanying automated test that was verified to fail before the code was written.
2. **Typecheck Cleanliness:** `bun run typecheck` passes with 0 warnings and 0 errors.
3. **Automated Suite Pass:** `bun test` passes 100% of unit and integration tests.
4. **Architectural Guard Check:** No files in `src/core/` import any non-core or browser package.
5. **Lint & Code Style:** Strict compliance with formatting rules, no unused variables, early returns applied, and module line limits respected (< 200 lines per file, < 80 lines per function).
6. **Regression Protection:** Any bug fix includes a regression test reproducing the exact failure mode (e.g., stale lock recovery, code indentation preservation, or background tab drift).
