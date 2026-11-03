---
name: convolink
description: Drive the browser the user is already logged into (ChatGPT, Claude, DeepSeek, Gemini) from an agent. Use when a task needs a web model's answer, a second opinion from a frontier model, a comparison of several models, or when the project has no API key but the user is signed in in Chrome. Also use when ConvoLink is not set up yet and you need to know the exact next step.
license: MIT
compatibility: claude-code, cursor, codex, opencode, antigravity, windsurf
metadata:
  version: 1.3.0
  package: convolink
  homepage: https://0xtanzim.github.io/convolink/
  repository: https://github.com/0xTanzim/convolink
  runtime: bun
  transport: extension-bridge
  bridge-port: 9224
  cdp-port: 9222
  platforms: chatgpt, claude, deepseek, gemini
---

## ⚡ Quick-Reference Card

| What you want | Tool | Key params |
|---|---|---|
| First use / any doubt | `convo_onboard` | — |
| Check status | `convo_status` | — |
| Send prompt (continuing) | `convo_ask` | `prompt`, `targetId` ← **pin from last response** |
| Resume a URL directly | `convo_ask` | `prompt`, `threadUrl` — skips all tab setup |
| Compare models | `convo_compare` | `prompt`, `platforms`, `continue:true` |
| Find open tabs (last resort) | `convo_list_tabs` | only when `targetId` is lost |
| Health check | `convo_doctor` | `fix:false` diagnose / `fix:true` ONLY on user request |
| Search conversation history | `convo_search` | `query` |

**Config lives in `.convo/config.json`** (dot-convo, NOT `convo/`). Never touch it — use `convo_status` to read it.

# ConvoLink

ConvoLink connects an agent to the **user's real, logged-in browser**. No API keys, no
second profile, no relaunch.

> This file is the single ConvoLink skill. Install it with
> `convo skill install --harness <name>`, or read it directly from
> `https://raw.githubusercontent.com/0xTanzim/convolink/main/skills/convolink/SKILL.md`.

Two transports exist and they are not interchangeable:

| | Companion extension | Direct CDP |
|---|---|---|
| User's everyday profile | **Works** | **Blocked** on Chrome 136+ |
| Port | `9224` | `9222` |
| Setup | load unpacked + paste token | `--remote-debugging-port` + `--user-data-dir` |

Default to the extension. Only reach for CDP when the user explicitly runs a dedicated
automation profile.

## Step 0 — never guess the state: run `convo onboard --json`

This single command replaces every "is it installed / paired / configured" question.
It returns `steps[]`, `nextAction`, and `requiresUserSelection`. **Obey `nextAction`.**

```bash
convo onboard --json
# Not on PATH (fresh machine, npx/bunx-only harness)? Same binary:
bunx convolink@latest onboard --json
```

Exit codes are the contract:

| Exit | Meaning | What you do |
|---|---|---|
| `0` | Ready | Use the browser tools |
| `2` | Configuration problem | Ask the user, or pass the documented argument |
| `3` | Transport down | Run the command in `nextAction` (usually `convo daemon start`) |
| `4` | **A human must act** | Show `nextAction.instruction` and stop |
| `5` | Reached, but not usable | Read `error.remediation` |
| `6` | Internal | Report it, do not retry in a loop |

`nextAction.kind` tells you who acts: `command` (you run it), `user` (the human acts),
`tool` (call that MCP tool with `nextAction.args`).

**Never edit `.convo/config.json` by hand.** If it is missing, `onboard` returns the
profile choice; that choice belongs to the user.

## Step 1 — setup, in the order the report gives

1. `convo daemon start` — the daemon owns port 9224. Nothing works without it.
2. Extension pairing is a **human** step; give the user the token and folder from
   `nextAction.instruction` verbatim. Do not invent paths.
3. Profile choice: ask the user, then `convo profile select <index|email>`.
4. Re-run `convo onboard --json` until exit `0`.
5. **Declarative/offline setup:** If you already know the browser and profile, pass `--save-only` (`convo setup --browser <name> --profile <path> --save-only` or MCP `convo_setup({ browser, profile, saveOnly: true })`) to persist `.convo/config.json` without requiring the browser socket to be active first.

If your harness supports MCP elicitation, `convo_setup` with no arguments renders the
choice as a native question and writes the config itself. Otherwise it returns the same
options as text — relay them to the user.

## Step 2 — verify before you use it

```bash
convo doctor                 # transport, tabs, selector health
convo list --json            # target ids of every supported tab
```

`convo doctor` names the exact fault. If it says the endpoint is the browser's default
profile, the fix is **not** a flag — switch to the extension.

## ⏱ Timing Contract

`convo_ask` and `convo_compare` are **synchronous-blocking calls**. They do NOT return until the browser AI finishes generating. Do NOT call any other tool while waiting.

| Tool | Typical wait |
|---|---|
| `convo_ask` — standard | 10–60 s |
| `convo_ask` — `think:true` | 30–180 s |
| `convo_compare` — 3 platforms | 60–300 s |
| `convo_onboard` / `convo_doctor` | 2–10 s |

**Stream-timeout edge case:** If `convo_ask` returns `error.code: "transport-timeout"` but the answer was visible on screen, do NOT resubmit. Call `convo_list_tabs` to inspect tab state.

## 🔖 Session Memory — Pin the Tab

After any successful `convo_ask`:
1. Read `structured.tabId` → store it as `targetId` for this conversation.
2. Read `structured.threadUrl` → keep for cross-session resume.
3. Pass `targetId` on **every subsequent** `convo_ask` to the same platform.
4. Do NOT call `convo_list_tabs` every turn — only when `targetId` is lost.
5. Do NOT call `convo_tab new` if a `managed:true` tab already exists for the platform.
6. Do NOT call `convo_onboard` again mid-session unless you see `error.code: "transport-down"`.

## 📁 Configuration Layout

The config directory is `.convo/` (dot-convo). Never search for `convo/` without the dot.

```
<project-root>/
└── .convo/               ← dot-convo, NOT convo/
    └── config.json       ← written ONLY by convo_setup or convo_profile select
```

- To read config → `convo_status`. Never read `.convo/config.json` directly.
- To change profile or browser → `convo_setup` or `convo_profile`.
- If `.convo/` is absent → call `convo_onboard` (setup has not run yet).

## 🔄 Cross-Session Reconnect

When the user gives you a `targetId`, `threadId`, or URL from a previous session:

1. `convo_list_tabs` → if `managed:true` tab exists → use `targetId` directly in `convo_ask`.
2. If tab not found → `convo_thread(action:"resume", threadId=<id>)` → get new `targetId`.
3. **Never call `convo_doctor(fix:true)` to reconnect.** `fix:true` kills live session locks and destroys active conversations.

## Step 3 — do the work

```bash
convo ask "question" -p chatgpt --transport extension-bridge --json
convo ask "question" -p deepseek --think --search --json
convo compare "trade-off" --platforms chatgpt,claude,deepseek --arbitrate
convo tab new deepseek
convo tab close <targetId>
```

`--json` always emits one envelope: `{ ok, command, data, error }`. Branch on `ok` and
`error.code`, never on prose.

Useful codes: `not-owned` (refused to close a tab ConvoLink did not open, exit 4),
`session-busy` (another run holds the tab, retry later), `login-required` /
`challenge-detected` (send the user to the browser), `extension-unsupported` (that
operation has no extension equivalent).

## MCP tools

Registered as `convolink` over stdio (`convo mcp`). Preferred over the CLI when your
harness supports MCP — it keeps the daemon and the state consistent.

| Tool | Use |
|---|---|
| `convo_status` | transport + project config |
| `convo_onboard` | the same report as `convo onboard --json` |
| `convo_setup` | pick browser/profile (asks the user when it can) |
| `convo_profile` | list/select the project profile |
| `convo_doctor` | health + remediation |
| `convo_list_tabs` | discover target ids |
| `convo_tab` | new/focus/close |
| `convo_ask` | one prompt, one answer |
| `convo_compare` | fan out + arbiter |
| `convo_search` / `convo_thread` | ledger history |

## 🔀 Decision Rules (follow in order, skip steps you already have)

1. **New session?** → `convo_onboard`. Stop until `ok:true`.
2. **Have `threadUrl`?** → `convo_ask(prompt, threadUrl)`. No tab setup needed.
3. **Have `targetId` from this session?** → `convo_ask(prompt, targetId)`. Skip steps 4–5.
4. **No `targetId`?** → `convo_list_tabs`. Find `managed:true` tab. Use its `targetId`.
5. **No managed tab?** → `convo_tab(action:"new", target:"<platform>")`, then `convo_ask`.
6. **Got an error?** → Read `error.code`. Follow `error.nextTool` hint. Retry **once** max.
7. **Need to reset?** → `convo_doctor(fix:false)` to diagnose. `fix:true` ONLY on explicit user instruction.

Original safety rules (still apply):
- **Never spawn a browser** to "fix" a connection. That creates an unauthenticated ghost.
- **Never close a tab you did not open.** The extension enforces this with `not-owned`.
- **One tab per concurrent run.** The lock is PID-aware; `session-busy` means wait.
- A timeout with the answer visible on screen is not a reason to resubmit — check the tab first.
- The extension cannot `eval` arbitrary JavaScript. Unsupported operations fail loudly.

## References

- `references/mcp.md` — full tool schemas and error envelopes
- `references/directives.md` — `// filepath:` artifact extraction
- Repository: `docs/AI_HARNESSES.md`, `docs/EXTENSION_CONTROL.md`
