# QA Matrix — Extension and CDP Transports

Every row is a scenario that must be executed before the extension is treated as the primary transport. "Expected" is the observable result; "Evidence" is how it was checked.

## Baseline per platform

| # | Scenario | Expected | Observed |
|---|---|---|---|
| B1 | `convo ask -p chatgpt` over the extension | Answer text, no stray tabs | `qa62`, 2.8s |
| B2 | Two sequential ChatGPT asks | Two different correct answers | `qa62` then `qa63`, same thread |
| B3 | `convo ask -p deepseek` over the extension | Answer text, reasoning excluded | `newone` 1.4s, `newtwo` 1.8s |
| B4 | DeepSeek ask using reasoning mode | Completes while the reasoning panel stays mounted | `thinklive` 1.1s, `thinktwo2` 1.6s |
| B5 | `convo ask -p gemini` over the extension | Answer text | `geminilive`, 51s |
| B6 | `convo ask -p claude` over the extension | Answer text | `claude5`, 1.6s |
| B7 | `convo compare` on two platforms | Both report success | chatgpt 6.4s + deepseek 1.6s |
| B8 | `convo compare` on a freshly created tab | New tab returns an answer | `freshtab` on a new DeepSeek tab |
| B9 | `convo tab new` / `list` / `focus` / `close` | Tab created, listed, focused, closed | all four |
| B10 | `convo ext status` | Client, profile, version, build id, tab count | matches `build-meta.json` |
| B11 | `convo ext exec DIAGNOSE` | Composer/send found, turn count, visibility, window state | reported; blind to shadow DOM (Gemini) |
| B12 | `convo doctor` over the extension | `extension ok` with client count | reported |

## Worst-case scenarios

| # | Scenario | Expected | Evidence |
|---|---|---|---|
| W1 | Stale bundle (rebuild without reload) | New command returns `unsupported`; build id differs from `build-meta.json` | `Unknown command: APPLY_TOGGLES` while `mw05ehhv` ran and `mw07881b` was built |
| W2 | Bridge stopped | Actionable "start the bridge" message; reconnect after restart | `transport-disconnected` + `convo daemon start`; reconnected in 9s |
| W3 | Invalid token | Handshake rejected; no connected client | bridge test: bad token rejected, 0 clients |
| W4 | Service-worker suspension | Reconnect without user action; same installation identity | same profile/connection id after 75s idle |
| W5 | Logged-out profile | `login_required`, not a timeout | path verified by unit test; no signed-out profile available |
| W6 | CAPTCHA / verification wall | `turnstile` or `cloudflare`, not a retry loop | path verified by unit test; not triggerable here |
| W7 | Hidden or minimized window with a virtualized transcript | Window restored, transcript renders, turns > 0 | `hidden` answered in 1.3s while another tab was active |
| W8 | Tab closed mid-generation | Tab-not-found style error; lock released | `No active browser tab found ... query='319051479'`, lock file absent |
| W9 | Two browsers sharing one port (IPv4 default profile, IPv6 dedicated) | Dedicated profile is used; default profile never driven | doctor: IPv4 fail-fast, IPv6 ok |
| W10 | Concurrent asks on one tab | Second run reports contention; no interleaved output | `session-busy`, exit 4 |
| W11 | Compare with one failing platform | Healthy platform still returns a result | chatgpt 3.1s done, claude failure isolated |
| W12 | Impossible prompt | Fails within the timeout budget and reports the last probe error | `transport-timeout`, exit 3 at 1.2s budget |
| W13 | Debugger already attached | Trusted input reports a structured error; other commands work | unit test: DOM fallback attempted, read-only commands unaffected |
| W14 | Screenshot without permission | `unsupported` with the reason; other commands work | `Either the '<all_urls>' or 'activeTab' permission is required` |
| W15 | Probe without a selector contract | `extension-unsupported`; no empty selector is sent | unit test |
| W16 | Assistant turn mounts before text streams | No completion until text exists | unit test |

## Known weaknesses found by this matrix

- **Gemini renders in shadow DOM.** `DIAGNOSE` reports `bodyLength: 113` and `sendFound: false` on a working Gemini tab, because body `innerText` and query selectors cannot see into the shadow root. The ask still completes (51s), but the diagnostic is misleading and the send control is reached only through the Enter fallback.
- **Gemini latency.** 51s for a one-word answer, versus 1-4s for ChatGPT, Claude and DeepSeek. The completion probe likely waits out a quiescence window it cannot observe.
- **Claude transcript.** The 2026 build replaced `[data-testid='chat-message']` with per-role containers; answers also carry icon-font glyphs and a trailing `just now` in `innerText`. Both are handled in `operations.ts`.
- **`tab close` reported success on a refused tab.** The daemon returned `not-owned`, but the CLI ignored the reply and printed `Closed tab`. Fixed: the reply is checked, `not-owned` is a first-class code (exit 4), and `--json` now emits a failure envelope for every command.
- **Ownership identity matched on URL and on the `default` thread placeholder.** Any tab at `https://chatgpt.com/` was reported as managed, because an old record shared that root URL. Fixed: only the target id or a real thread id identifies a tab.
- **Stale lock files accumulate.** An aborted run (timeout, daemon restart) leaves `tab-<id>.lock` in `$XDG_RUNTIME_DIR/convolink`. They are reclaimed on the next acquire because the holder PID is dead, so they are harmless, but 13 had accumulated during one QA session.
- **Extension-unsupported probes were silently swallowed.** The driver wraps the auth check and the turn fingerprint in `.catch()`, so a missing mapping surfaced later as a misleading timeout instead of naming the unmapped script.

## Running the matrix

```bash
# extension transport
convo daemon start
convo ext status
convo ask -p chatgpt --transport extension-bridge "Reply with: qa-1"
convo ask -p deepseek --transport extension-bridge "Reply with: qa-2"
convo compare "Reply with: qa-3" --platforms chatgpt,deepseek
convo ext exec DIAGNOSE '{"platform":"chatgpt"}' --target <id>

# CDP transport against a dedicated profile
CONVOLINK_TRANSPORT=raw-cdp CONVOLINK_PORT=9222 CONVOLINK_HOST='[::1]' convo ask -p chatgpt "Reply with: qa-4"
CONVOLINK_HOST='[::1]' convo doctor

# blocked default profile must fail fast, never hang
convo doctor    # with transport raw-cdp on the default profile port
```

## Recording results

Record for each row: transport, platform, expected, observed, duration, and the build id shown by `convo ext status`. A row without a build id is not reproducible after a rebuild.
