# QA Matrix — Extension and CDP Transports

Every row is a scenario that must be executed before the extension is treated as the primary transport. "Expected" is the observable result; "Evidence" is how it was checked.

## Baseline per platform

| # | Scenario | Expected | Evidence |
|---|---|---|---|
| B1 | `convo ask -p chatgpt` over the extension | Answer text, no stray tabs | answer returned |
| B2 | Two sequential ChatGPT asks | Two different correct answers | two answers |
| B3 | `convo ask -p deepseek` over the extension | Answer text, reasoning excluded | answer returned |
| B4 | DeepSeek ask using reasoning mode | Completes while the reasoning panel stays mounted | completed |
| B5 | `convo ask -p gemini` over the extension | Answer text | pending |
| B6 | `convo ask -p claude` over the extension | Answer text | pending |
| B7 | `convo compare` on two platforms | Both report success | both success |
| B8 | `convo compare` on a freshly created tab | New tab returns an answer | pending |
| B9 | `convo tab new` / `list` / `focus` / `close` | Tab created, listed, focused, closed | all four |
| B10 | `convo ext status` | Client, profile, version, build id, tab count | matches `build-meta.json` |
| B11 | `convo ext exec DIAGNOSE` | Composer/send found, turn count, visibility, window state | reported |
| B12 | `convo doctor` over the extension | `extension ok` with client count | reported |

## Worst-case scenarios

| # | Scenario | Expected | Evidence |
|---|---|---|---|
| W1 | Stale bundle (rebuild without reload) | New command returns `unsupported`; build id differs from `build-meta.json` | build id comparison |
| W2 | Bridge stopped | Actionable "start the bridge" message; reconnect after restart | message + reconnect |
| W3 | Invalid token | Handshake rejected; no connected client | status shows none |
| W4 | Service-worker suspension | Reconnect without user action; same installation identity | same client id |
| W5 | Logged-out profile | `login_required`, not a timeout | error code |
| W6 | CAPTCHA / verification wall | `turnstile` or `cloudflare`, not a retry loop | error code |
| W7 | Hidden or minimized window with a virtualized transcript | Window restored, transcript renders, turns > 0 | turn count |
| W8 | Tab closed mid-generation | Tab-not-found style error; lock released | error + lock state |
| W9 | Two browsers sharing one port (IPv4 default profile, IPv6 dedicated) | Dedicated profile is used; default profile never driven | doctor + ask |
| W10 | Concurrent asks on one tab | Second run reports contention; no interleaved output | lock error |
| W11 | Compare with one failing platform | Healthy platform still returns a result | partial success |
| W12 | Impossible prompt | Fails within the timeout budget and reports the last probe error | error text |
| W13 | Debugger already attached | Trusted input reports a structured error; other commands work | error + list/status |
| W14 | Screenshot without permission | `unsupported` with the reason; other commands work | error |
| W15 | Probe without a selector contract | `extension-unsupported`; no empty selector is sent | unit test |
| W16 | Assistant turn mounts before text streams | No completion until text exists | unit test |

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
