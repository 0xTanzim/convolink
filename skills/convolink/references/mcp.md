# ConvoLink MCP Reference (v1.3.4)

Registered as `convolink` over stdio (`convo mcp`). Add to your MCP config:

```json
{ "convolink": { "command": "convo", "args": ["mcp"] } }
```

---

## Tool Index (11 tools)

| Tool | Purpose | Blocking? |
|---|---|---|
| `convo_onboard` | Readiness report + single next action | No (2–8 s) |
| `convo_status` | Active transport + resolved config | No |
| `convo_ask` | Submit prompt, await full response | **Yes (10–180 s)** |
| `convo_compare` | Fan-out across models + optional arbiter synthesis | **Yes (60–300 s)** |
| `convo_doctor` | Health check; `fix:true` KILLS live locks | No |
| `convo_list_tabs` | Discover open managed AI tabs | No |
| `convo_tab` | `new` / `close` / `back` / `undo` | No |
| `convo_setup` | Persist browser + profile config | No |
| `convo_profile` | `list` / `select` profiles | No |
| `convo_search` | FTS5 search across conversation history | No |
| `convo_thread` | `export` / `resume` / `history` | No |

---

## Error Envelope

All tools emit errors as `isError:true` with a `structured.error` object. Branch on `error.code`:

```json
{
  "code": "transport-down",
  "message": "Extension bridge not reachable on port 9224.",
  "retryable": false,
  "nextTool": "convo_doctor",
  "nextArgs": { "fix": false }
}
```

| Code | Meaning | Retryable | `nextTool` |
|---|---|---|---|
| `configuration-required` | No `.convo/config.json` | No | `convo_onboard` |
| `configuration-invalid` | Corrupt config file | No | `convo_onboard` |
| `browser-unreachable` | Port offline | No | `convo_doctor` |
| `transport-disconnected` | Daemon/extension offline | No | `convo_doctor` |
| `session-busy` | Tab locked by another process | Yes (wait 5 s) | retry `convo_ask` once |
| `transport-timeout` | Model generation timed out | No | inspect tab manually |
| `login-required` | Platform needs user auth | No | tell user |
| `challenge-detected` | CAPTCHA / Cloudflare | No | tell user |
| `not-owned` | Tried to close unowned tab | No | stop |
| `extension-unsupported` | Operation needs extension transport | No | switch transport |

---

## `convo_ask`

**BLOCKING — 10 to 180 s. Do NOT call any other tool until it returns.**

**Autonomous & Self-Provisioning:** Passing `platform: "deepseek"` (or any supported platform) automatically connects to an existing open tab or spawns a new one in the background. Calling `convo_list_tabs` or `convo_tab` beforehand is NOT required.

```typescript
convo_ask({
  prompt: string,               // required
  platform?: "chatgpt" | "deepseek" | "gemini" | "claude",
  targetId?: string,            // ← reuse tab from last response (PIN THIS)
  threadUrl?: string,           // direct resume URL — skips tab setup entirely
  think?: boolean,              // enable reasoning mode (30–180 s)
  search?: boolean,             // enable live web search grounding
  writeFiles?: boolean,         // extract code blocks via '// filepath:' directives
  outDir?: string,              // output dir for extracted files (default: ./artifacts)
  openTab?: boolean,            // force spawn a new background tab (auto-created if none exists)
  newChat?: boolean,            // DESTRUCTIVE — resets current thread context
  workspaceRoot?: string,       // absolute project path (auto-discovered if omitted)
})
```

**Output — pin `tabId` for next call:**
```typescript
{
  tabId: string,        // ← PIN THIS. Pass as targetId on every subsequent convo_ask.
  platform: string,
  threadUrl: string | null,
  threadId: string | null,
  elapsedMs: number,
  text: string,
}
```

---

## `convo_compare`

**BLOCKING — 60 to 300 s.**

```typescript
convo_compare({
  prompt: string,
  platforms?: Array<"chatgpt" | "deepseek" | "gemini" | "claude">,
  arbitrate?: boolean,
  arbiter?: "chatgpt" | "deepseek" | "gemini" | "claude",
  continue?: boolean,           // reuse currently open managed tabs
  threads?: {                   // per-platform URLs to resume specific conversations
    chatgpt?: string,
    deepseek?: string,
    gemini?: string,
    claude?: string,
  },
  workspaceRoot?: string,
})
```

---

## `convo_tab`

One tool for all tab lifecycle. Do NOT use `convo_tab new` if `convo_list_tabs` already shows a managed tab:

```typescript
convo_tab({ action: "new",   target: "deepseek" | "chatgpt" | "gemini" | "claude" | "<url>" })
convo_tab({ action: "close", targetId: string })   // only closes tabs ConvoLink opened
convo_tab({ action: "back",  targetId?: string })
convo_tab({ action: "undo",  targetId?: string })  // restore URL before accidental reset
```

---

## `convo_thread`

One tool for all thread operations:

```typescript
convo_thread({ action: "export",  threadId: string, format?: "markdown" | "json" })
convo_thread({ action: "resume",  threadId: string })  // returns new targetId
convo_thread({ action: "history", targetId?: string })
```

---

## `convo_setup`

Persist browser and profile configuration to `.convo/config.json`.
When called with no parameters, triggers interactive elicitation. When called with parameters, applies declaratively:

```typescript
convo_setup({
  browser?: "chrome" | "brave" | "edge" | "chromium" | "firefox" | "zen",
  profile?: string,             // profile directory path or profileId
  transport?: "extension-bridge" | "raw-cdp" | "firefox-bidi" | "agent-browser",
  saveOnly?: boolean,           // save config without probing browser socket (offline/declarative)
  noVerify?: boolean,           // alias for saveOnly
  workspaceRoot?: string,       // absolute project path (required if MCP started from $HOME)
})
```

---

## `convo_profile`

```typescript
convo_profile({ action: "list" })
convo_profile({ action: "select", target: "1" | "user@example.com" | "Profile Name" })
```

---

## `convo_doctor`

```typescript
convo_doctor({ fix: false })  // diagnose (safe, read-only)
convo_doctor({ fix: true  })  // KILLS live session locks — only on explicit user instruction
```

---

## `convo_onboard`

No parameters. Call once per session before any browser work. Repeat until `ok:true`.

`nextAction.kind` values:
- `"command"` — agent runs `nextAction.command`
- `"user"` — human must act; show `nextAction.instruction` and stop
- `"tool"` — call `nextAction.tool` with `nextAction.args`
