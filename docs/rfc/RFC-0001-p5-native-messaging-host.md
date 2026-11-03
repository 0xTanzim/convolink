# RFC-0001 — Native Messaging Host for the Companion Bridge (P5)

| | |
|---|---|
| Status | Proposed |
| Phase | P5 (`Next_plan.md` §5) |
| Author | ConvoLink maintainers |
| Created | 2026-11-03 |
| Supersedes | — |
| Depends on | stable extension identity (see §4.1) |

## 1. Problem

Today the extension bridge needs a long-lived process the user starts by hand:

```
convo daemon start   →  binds 127.0.0.1:9224  →  extension connects  →  agent works
```

If that process is not running, an agent following `convo onboard --json` gets
`nextAction.kind = "command"` and must run `convo daemon start` — a terminal step in
the middle of an otherwise automated flow. On a fresh machine this is the single most
common failure mode observed in the field: the agent is paired, the profile is set,
and nothing answers on 9224.

P5 was scoped as *"Auto-launch extension bridge, `convo ext install-host`, zero-config
background link"*. This RFC proposes the smallest mechanism that delivers that, and
records the constraints that make the naive version unsafe.

## 2. Current state (measured, not assumed)

| Fact | Evidence |
|---|---|
| Bridge is a WebSocket server on `127.0.0.1:9224`, owned by the daemon | `src/entrypoints/cli.daemon.ts`, `daemon-status.json` |
| Clients authenticate with a 32-byte token, timing-safe compared | `src/core/services/bridge-token.service.ts` |
| Extension is protocol-v2 only; a v1 build is rejected | `docs/MCP_REFERENCE.md`, `docs/EXTENSION_CONTROL.md` |
| MCP degrades to an in-process container when no daemon answers (it then binds 9224 itself) | `src/entrypoints/mcp.orchestrator.ts:28-37` |
| The unpacked extension has **no `key` field**, so its ID is derived from the absolute install path | built `manifest.json` keys: `manifest_version, name, version, description, permissions, host_permissions, background, action` |
| No native-messaging code exists | `grep -rn "install-host\|nativeMessaging" src/ scripts/` → 0 hits |

That last row of the table is the whole problem this RFC has to solve around: **native
messaging allowlists name an extension ID**, and our ID is different on every machine
because it is path-derived. Any design that assumes a fixed ID without pinning one is
dead on arrival.

## 3. Options

### Option A — Replace the WebSocket transport with native messaging

The extension talks to a host binary over stdio (`chrome.runtime.connectNative`) and the
9224 WebSocket disappears.

- **Gains:** no port, no token, no daemon; Chrome manages the process lifetime.
- **Costs:** rewrites the extension transport, the daemon client, the protocol
  versioning and every test that assumes a socket. Firefox uses a different native
  messaging API, so it is a second implementation. Loses the ability to attach an
  agent from another machine or container to `127.0.0.1:9224`.
- **Verdict:** correct end state, wrong first step.

### Option B — Native messaging as a launcher/supervisor (recommended)

Keep the WebSocket bridge exactly as it is. Add a tiny host binary whose only jobs are:

1. `ensure` — start the daemon if it is not already answering, wait for 9224, exit.
2. `status` — report `{daemon: running|absent, endpoint, version}`.
3. `version` — report host and CLI versions so a mismatch is visible.

The extension calls `connectNative` once at startup (and after a browser restart). The
host exits immediately; the extension then connects to 9224 as it does today.

- **Gains:** zero protocol change, zero security-model change, Firefox unaffected, and
  the "keep a terminal open" step disappears. Failure is local: if the host is missing,
  behaviour is exactly today's.
- **Costs:** still ships a native binary per OS; needs the pinned extension ID (§4.1).
- **Verdict:** recommended.

### Option C — Web Store distribution, keep WebSocket

Publish to the Chrome Web Store so installation stops requiring Developer mode.

- **Gains:** removes the human "load unpacked" step.
- **Costs:** review latency, store policy on `<all_urls>`/`debugger`, and it does not
  start the daemon — the thing P5 was actually scoped to fix.
- **Verdict:** orthogonal. Worth doing, but not a substitute.

## 4. Design (Option B)

### 4.1 Stable extension identity (prerequisite)

Add a `key` to the generated manifest so the ID is fixed for every install:

```jsonc
// scripts/build-extension.ts → buildManifest()
{
  "key": "<base64 SPKI public key, committed once>"
}
```

Consequences:

- The unpacked ID becomes identical on every machine, so a host manifest can be
  generated with a real `allowed_origins` entry at build time.
- The same ID can later be reused for Web Store publishing (Option C).
- **Migration:** existing users' IDs change once, which invalidates nothing durable —
  pairing is token-based, not ID-based. `chrome://extensions` shows the new ID after
  reload, and the user must reload once. This is the only user-visible break.

### 4.2 Host identity and registration

```
com.convolink.bridge          (Linux + macOS manifest name)
com.convolink.bridge.json
```

| OS | Manifest location | Extra step |
|---|---|---|
| Linux | `~/.config/google-chrome/NativeMessagingHosts/com.convolink.bridge.json` | none |
| Linux (Chromium/Brave/Edge) | same, under each product's config dir | none |
| macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/…` | none |
| Windows | `%LOCALAPPDATA%\ConvoLink\…json` | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.convolink.bridge` → manifest path |

Manifest shape:

```json
{
  "name": "com.convolink.bridge",
  "description": "Starts the ConvoLink bridge daemon on demand",
  "path": "/absolute/path/to/convo-host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://<pinned-id>/"]
}
```

`path` must be absolute — Chrome resolves nothing on `PATH`.

### 4.3 CLI surface

```bash
convo ext install-host [--browser chrome|chromium|brave|edge|all] [--dry-run]
convo ext uninstall-host
convo ext host-status
```

- `install-host` writes the manifest(s), sets the Windows registry key, `chmod 755` the
  host binary, and prints what changed. `--dry-run` prints the diff.
- Idempotent: re-running rewrites identical content and reports "already installed".
- Refuses to write when the built manifest has no `key` (i.e. no stable ID), because a
  host manifest pointing at a non-existent extension ID is worse than none.

### 4.4 Host protocol

Native messaging framing: 4-byte little-endian length prefix + UTF-8 JSON. Chrome sends
`{ "command": ... }` on argv or stdin; the host writes one response object and exits.

```jsonc
// request
{ "command": "ensure", "cliVersion": "1.2.1" }

// success response
{ "ok": true, "daemon": "running", "endpoint": "http://127.0.0.1:9224", "pid": 4812, "started": true }

// failure response (host never throws at the client)
{ "ok": false, "daemon": "absent", "error": "spawn failed: ENOENT", "hint": "run `convo onboard --json`" }
```

Rules:

- Only three commands. An unknown command returns `{ok:false}` — the host is not a shell.
- Timeout: 10 s to reach a healthy 9224, then report failure and exit non-zero. Chrome
  kills the host if it writes nothing for 30 s; the host must always answer.
- The host **never** holds the bridge open. It is a supervisor, not a transport.

### 4.5 Security

| Threat | Mitigation |
|---|---|
| Another extension asks the host to start a daemon | Chrome enforces `allowed_origins`; the host re-checks the origin argument it receives |
| Host becomes a command runner | fixed command set, no argv passthrough, no shell |
| Token leakage to the host | the host never reads or prints the bridge token |
| Privilege escalation via manifest | written to the user's own config dir, mode `0600`, no system-wide install |
| Spoofed host binary | `path` must resolve inside the ConvoLink install root; `install-host` refuses anything else |

### 4.6 Compatibility

- No change to `9224`, the token flow, or protocol v2. Agents that already work keep
  working, with or without the host.
- Absent host ⇒ today's behaviour (agent runs `convo daemon start`). `convo onboard`
  gains one optional step, `host`, reported as `done` when installed.
- Firefox: `allowed_extensions` uses the Gecko add-on ID (`companion@convolink.local`),
  which is already fixed, so the same host binary works with a different manifest.

## 5. Testing

| Layer | Test |
|---|---|
| Unit | frame encoder/decoder: length prefix, split reads, oversized frame rejected |
| Unit | manifest generation per OS target (paths, `allowed_origins` from the pinned key, registry key on Windows) |
| Unit | `install-host` is idempotent and refuses when `manifest.key` is missing |
| Unit | host command dispatch: `ensure`/`status`/`version`, unknown command → `{ok:false}` |
| Integration | spawn the host binary with a fake `convo` on `PATH`, assert the daemon start call and the 10 s timeout path |
| Integration | daemon already running ⇒ host returns `started:false` and exits 0 |
| Manual | real Chrome: load unpacked, open tab, no terminal running, `convo ask` succeeds |
| Manual | uninstall host ⇒ `onboard` reports the old command step again, nothing breaks |

CI cannot verify Chrome's native messaging itself; the manual rows are release gates.

## 6. Rollout

1. Land §4.1 (`key`) alone, ship it, and let IDs settle for a release.
2. Land the host + `install-host`, off by default, documented.
3. Add `host` to `convo onboard --json` as an optional step.
4. After one release with no regressions, make the installer offer it by default.
5. Only then consider Option A (stdio transport) as a separate RFC.

## 7. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Pinned `key` changes existing IDs | certain | one manual reload per user | call it out in release notes, one-time |
| Windows registry step fails silently for non-admin users | medium | host never launches | `convo ext host-status` verifies by reading the key back |
| Host spawns a daemon that outlives it | low | duplicate daemons | reuse `DaemonClient.isAlive()` before spawning; PID-aware lock already exists |
| Store review rejects `debugger` permission | medium | Option C blocked | P5 does not depend on Option C |
| Users on locked-down machines cannot install a host at all | medium | P5 unavailable | fallback path stays first-class, never removed |

## 8. Acceptance criteria

- [ ] Generated manifests contain a stable `key`; the same ID appears on two different machines.
- [ ] `convo ext install-host` writes the correct manifest per OS and is idempotent.
- [ ] With no daemon running, opening a browser tab makes `convo ask` succeed without a terminal command.
- [ ] With the host uninstalled, behaviour is byte-identical to 1.2.x.
- [ ] `convo onboard --json` reports a `host` step and its remediation.
- [ ] Full suite green, typecheck clean, no file over the line ceiling.

## 9. Open questions

1. Ship the host as a Bun single-file binary per OS, or as a `bun`-driven script (requires
   Bun on the user's machine)? Single-file is honest for native messaging, which expects
   an executable.
2. Do we pin the `key` now and accept one ID change, or generate the host manifest from
   the observed ID at install time? Pinning is preferable and is assumed above.
3. Should `install-host` also register the MCP server config for detected harnesses, or
   stay strictly about the bridge?

## 10. Effort

| Work | Estimate |
|---|---|
| `key` + ID migration | 1 session |
| host binary + framing + tests | 1–2 sessions |
| `install-host` / `uninstall-host` / `host-status` per OS | 1 session |
| onboard integration + docs + website | 0.5 session |
| live Chrome/Firefox verification | 0.5 session |

Two focused days, gated on the manual verification rows.
