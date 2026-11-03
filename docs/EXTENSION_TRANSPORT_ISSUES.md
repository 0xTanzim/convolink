# Extension Transport — Two Open Platform Issues

Status: three issues actually; the third is a policy gap. Owner: ConvoLink runtime.
Scope: `extension-bridge` transport driving ChatGPT, DeepSeek, Gemini and Claude in a
real, logged-in Chrome profile.

This report covers the two defects that remain **open** after the
`harden-extension-control-and-live-qa` QA pass, plus one policy gap found while
verifying tab ownership. Everything is reproducible from the recorded evidence below;
nothing here is a guess. The third section is short because its impact is a policy
question rather than a rendering failure.

---

## 1. DeepSeek can accept a prompt and never render the transcript

### Current situation

A freshly created DeepSeek tab receives the prompt, navigates to the conversation URL,
and then renders **no message list at all**. The tab is healthy by every signal the
extension can observe:

```
url            https://chat.deepseek.com/a/chat/s/2d821a55-...
windowState    normal
visibilityState visible
documentHidden false
hasFocus       true
composerFound  true
bodyLength     701          ← sidebar + composer only
turns           0
assistantText  ""
```

`PROBE_STATUS` reports `turnsCount: 0`, so `pollUntilSettled` keeps waiting and the run
ends as `transport-timeout` even though the prompt was delivered. Reloading the *same*
tab resolves it and the answer is there:

```
RELOAD → PROBE_STATUS: turnsCount 2, assistantText "The user wants a single word reply..."
```

That reload also exposed issue 2 (the reasoning text), which is now fixed.

### Why it likely happens

DeepSeek's client is a virtualised SPA: it decides whether to mount the message list
from its own hydration state and viewport state. The extension cannot observe that
state; it only sees the DOM. Nothing in our code makes the difference — the same tab
type succeeded minutes earlier on the same machine (1.4 s), then failed twice, then
succeeded again after a reload. That is the signature of a client-side mount that
sometimes never completes, not of a selector regression.

### Impact

- The command reports a timeout while the platform actually has the answer queued.
- A user retrying the command submits the prompt a second time, so the conversation
  gains duplicate turns.
- It is intermittent, so it looks like flakiness rather than a defect.

### Options

| Option | Behaviour | Cost |
|---|---|---|
| **A. Bounded reload recovery** (recommended) | After submitting, if `turnsCount` stays `0` for ~8 s **and** the URL is a conversation, reload once, then continue waiting inside the same budget | One extra reload, only on the broken path; needs its own test |
| B. Fail fast on an empty transcript | Report `not-ready` with "the transcript did not mount; reload the tab" instead of waiting out the timeout | Honest and cheap, but pushes the recovery onto the caller |
| C. Keep waiting longer | Raise the timeout | Does not help: the DOM never mounts, so extra time changes nothing |

### Recommendation

Option A with option B as the fallback when the reload does not render either. The
reload is safe because the prompt is already server-side; the conversation is the
source of truth, not the tab.

Priority: **high** — it fails a platform that is otherwise the fastest in the fleet
(1.1 s in the final comparison).

Verification plan: force the failure by creating a tab and closing/reopening the
window, then assert `turnsCount > 0` after recovery and that exactly one reload was
issued (trace count), plus a unit test with a fake browser that returns `turns: 0` twice
and then a mounted transcript.

---

## 2. Gemini: shadow DOM hides its controls and completion is unreliable

### Current situation

Gemini's UI renders inside a shadow root. From the page's light DOM the extension sees
almost nothing:

```
bodyLength    113 – 576        ← against thousands of characters of visible UI
composerFound true
sendFound     false            ← the send control is inside the shadow root
```

Two consequences:

1. `DIAGNOSE` is misleading. It reports `sendFound: false` on a tab that works, so the
   diagnostic cannot be used to distinguish "selector drift" from "shadow DOM".
2. The send path only works because of the Enter fallback in `submitWithRecovery`. The
   click is never delivered.

Completion timing is also unstable on the same bundle:

| Run | Result |
|---|---|
| compare (`cmpiso`) | `cmpiso`, 14.3 s |
| direct ask | `geminilive`, 51.2 s |
| direct ask | `gemtwo`, 3.6 s |
| direct ask | timeout at 100 s — answer was on the page afterwards (`assistantText: "finalgem"`, `turnsCount: 3`) |

The last row is the same class of failure as the Claude stop-control bug: the answer
exists, the probe misses the completion signal.

### Why it likely happens

The completion probe uses `document.querySelector` for the stop control and the turn
containers. Shadow content is invisible to those queries, so `isGenerating` depends on
whatever light-DOM remnant exists. When the light DOM does not expose a stop control,
completion depends entirely on text quiescence, which the virtualised list can reset
indefinitely. `turnsCount: 3` for a single prompt + answer also suggests an extra
container (a thinking block) is counted as a turn.

### Impact

- Gemini is the slowest and least predictable platform over the extension (3.6 s to
  > 100 s for a one-word answer).
- `DIAGNOSE` gives a false negative on `sendFound`, which wastes support time.
- A timeout can be reported while the answer is visible on screen.

### Options

| Option | Behaviour | Cost |
|---|---|---|
| **A. Pierce the shadow root** (recommended) | Add a deep-query helper in the injected ops: walk `shadowRoot` children when `querySelector` misses, and use it for status/read/composer/send | Moderate; must stay inside the injected-function constraints (no closures, self-contained) |
| B. Declare Gemini light-DOM-only | Document that Gemini needs the CDP transport | Cheap, but drops a supported platform from the primary transport |
| C. Content-script world access | Run the probe in the content script with `chrome.scripting` world `MAIN` | Wider surface; bypasses the "no arbitrary JS" boundary we deliberately keep |

### Recommendation

Option A. The selector table stays the source of truth; only the query strategy changes.
Keep the current light-DOM path as the first attempt so nothing regresses for platforms
that do not use shadow DOM.

Priority: **medium-high** — correctness is fine on the happy path, but the failure is
silent (timeout with a visible answer).

Verification plan: a DOM fixture with a shadow root containing composer, send and one
turn; assert `DIAGNOSE` reports `sendFound: true` and `PROBE_STATUS` counts exactly one
turn. Then a live ask repeated three times without a reload, all under 20 s.

---

## 3. Policy gap: driving a foreign tab claims it

Not a rendering bug, but the same QA pass surfaced it.

`convo ask` against a tab the user opened **records that tab in the managed registry**.
After that, `convo tab close` closes it. The "ConvoLink only closes tabs it opened"
guarantee therefore holds only until ConvoLink first drives that tab.

Observed sequence:

```
convo list           → 319051662 managed False   (hand-opened)
convo ask --target   → success
convo list           → 319051662 managed True    (now claimed)
```

Options: record a tab as "driven" rather than "owned" (separate set, never closable
without `force`), or keep ownership but require `force` for any tab whose creation was
not observed. The first option matches the existing policy language and is a small
change to `tab-registry.ts` plus the close guard.

Priority: **medium** — destructive action behind a policy the user believes is absolute.

---

## What is already fixed (context for the three above)

Same QA pass, same commits: `TRUSTED_FILL` composer focus and retry, `--think` via an
`APPLY_TOGGLES` contract, Claude 2026 transcript selectors, Claude disabled stop control
no longer read as generation, `authCheck` / `findContinuationTrigger` mappings, DeepSeek
reasoning no longer returned as the answer, `tab close` no longer reports success when
refused (`not-owned`, exit 4), ownership identity no longer matches on URL or the
`default` thread placeholder, `--json` failure envelopes, MCP delegating to the daemon,
`doctor` failing fast on the blocked default profile, and a stale-bundle warning that
names both ids.

## Evidence sources

- `docs/QA_MATRIX.md` — executed rows and observed outcomes.
- `docs/EXTENSION_CONTROL.md` — supported command surface and unsupported boundary.
- Commits `eebc895`, `f9951f8`, `c32ac09`, `867f75c`, `01093fd`, `9b20770`, `ffe0824`,
  `101464d`, `78d1690`.
- Bundle `mw0bcpqe`; suite 566 pass / 8 skip / 0 fail; typecheck clean.
