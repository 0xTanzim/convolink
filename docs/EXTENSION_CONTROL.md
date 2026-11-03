# Extension Control Surface

The Companion extension is the transport that drives a real, logged-in browser profile without remote-debugging flags. Chrome 136+ refuses CDP on the default profile, so the extension is the only supported path there. This page documents what it can do, what it cannot, and how to prove which build is running.

## Transport selection

| Profile | Transport | Command |
|---|---|---|
| Default profile (Chrome, Brave, Edge, Chromium) | `extension-bridge` | `convo setup` → Extension |
| Dedicated debug profile | `raw-cdp` | `convo setup` → CDP, or `CONVOLINK_HOST` + `CONVOLINK_PORT` |
| Firefox / Zen | `firefox-bidi` | `convo connect --firefox` |

## Protocol commands

Every command is bounded: it has a request id, a per-request timeout, and a structured success or error result. The extension never evaluates arbitrary JavaScript.

### Connection

| Command | Purpose |
|---|---|
| `PING` | Liveness, version, protocol, build identifier |
| `LIST_TABS` | AI-domain tabs with ownership and platform |
| `TAB_INFO` | URL, title, window, active flag, ownership |

### Probing

| Command | Purpose |
|---|---|
| `PROBE_SELECTORS` | Which platform selectors resolve |
| `PROBE_MOUNTED` | Composer present and document complete |
| `PROBE_READY` | Composer present and send control usable |
| `PROBE_QUIET` | Structural fingerprint (nodes, text length) |
| `PROBE_COMPOSER_TEXT` | Composer currently holds text |
| `PROBE_STATUS` | Turn count, generating/thinking flags, assistant text, code blocks |
| `READ_THREAD` | Conversation turns with roles and code blocks |
| `DIAGNOSE` | URL, readiness, composer/send state, turn count, visibility, window state, build id |

Probe expressions carry their selectors in a machine-readable contract:

```js
/* convolink:selectors {"composer":"#prompt-textarea","send":"button[aria-label=\\"Send\\"]"} */
```

The transport reads that JSON. It never guesses which quoted literal is a selector — probes also contain literals such as `"complete"` and `"true"`.

### Input

| Command | Purpose |
|---|---|
| `FILL_TEXT` | DOM fill with verification |
| `FOCUS` | Focus a composer |
| `CLICK` | Click an element |
| `HOVER` | Pointer events over an element |
| `PRESS_KEY` | Synthetic key events |
| `TYPE_TEXT` | Insert text and optionally submit |
| `TRUSTED_FILL` | Clear, focus, insert through the browser input pipeline, verify |
| `TRUSTED_TYPE` | Browser-level `Input.insertText` |
| `TRUSTED_KEY` | Browser-level keystroke (used for Enter when synthetic keys are ignored) |

### Tabs and viewport

| Command | Purpose |
|---|---|
| `CREATE_TAB` | Open a tab ConvoLink owns |
| `CLOSE_TAB` | Close an owned tab only |
| `ACTIVATE_TAB` / `BRING_TO_FRONT` | Activate the tab and restore its window |
| `DUPLICATE_TAB` | Duplicate a tab |
| `NAVIGATE` | Navigate a tab |
| `RELOAD` | Reload a tab |
| `SCROLL`, `SCROLL_TO` | Scroll the page or an element into view |
| `WAIT_FOR_SELECTOR` | Bounded wait for an element |
| `GET_TEXT`, `GET_LAST_TEXT` | First or newest matching text |
| `GET_HTML` | Element HTML (bounded) |
| `SELECT_OPTION` | Set a select value |
| `SCREENSHOT` | Visible-tab capture, or `unsupported` when the permission is absent |

## CLI surface

```bash
convo ext pair                     # token + the exact folder Chrome must load
convo ext status [--json]          # clients, profile, version, build id, tab count
convo ext exec <COMMAND> '<json>' [--target <id>]   # raw protocol command
convo tab new <platform>
convo tab focus <targetId>
convo tab close <targetId>
convo list [--json]
convo ask -p <platform> "<prompt>" --transport extension-bridge
convo compare "<prompt>" --platforms chatgpt,deepseek
```

`convo ext exec` is the debugger: it runs exactly one protocol command and prints the raw result, which is how a selector or permission problem is diagnosed without guessing.

## Unsupported by design

| Not supported | Why |
|---|---|
| Arbitrary `eval` / `Runtime.evaluate` | MV3 content-script CSP blocks `eval()`; MAIN-world injection inherits page CSP |
| Closing tabs the user opened | Ownership is required so automation never destroys user work |
| Screenshots without permission | `captureVisibleTab` needs `<all_urls>` or a user gesture |
| Firefox trusted input | `chrome.debugger` is a different protocol on Gecko; BiDi covers Firefox |
| Reading a transcript that never mounts | The platform must render it; the extension restores the window to help |

## Failure modes and what you see

| Situation | Observed behaviour |
|---|---|
| Bridge not running | Commands fail with how to start it; the extension reconnects when it returns |
| Invalid token | Handshake rejected; `convo ext status` shows no connected client |
| Stale bundle | A new command returns `unsupported` naming it, and the build id differs from `build-meta.json` |
| Debugger already attached | Trusted input fails with a structured error, DOM fill is attempted, the fill is reported as not accepted |
| Platform login wall | `login_required`, not a timeout |
| Platform verification challenge | `turnstile` or `cloudflare`, not a retry loop |
| Hidden or minimized window | The extension activates and restores the window before waiting |
