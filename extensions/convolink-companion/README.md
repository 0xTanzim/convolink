# ConvoLink Companion Extension (Cross-Browser)

The **ConvoLink Companion** extension provides a **100% zero-flag, authenticated bridge** between your everyday browser (Chrome, Brave, Edge, Firefox) and local AI coding agents.

---

## Why This Exists
- In modern browsers, attaching remote debugging flags (`--remote-debugging-port`) against default user profiles is either blocked or causes intrusive yellow banners ("Chrome is being controlled by automated test software").
- Launching browsers with separate `--user-data-dir` creates empty ghost profiles where you are logged out of your AI accounts (ChatGPT, Claude, DeepSeek, Gemini).
- This extension runs securely inside your **real, everyday browser profile**, enabling ConvoLink to interact with your active tabs without stealing window focus, restarting your browser, or compromising security.

---

## Option 1: Download from GitHub Releases (Recommended for Developers)

Download pre-built extension packages directly from the repository's [Releases](https://github.com/convolink/convolink/releases):
- **Chromium Browsers (Chrome, Brave, Edge):** Download `convolink-companion-chrome.zip`.
- **Mozilla Firefox:** Download `convolink-companion-firefox.zip`.

### Installation:
#### In Google Chrome / Brave / Microsoft Edge:
1. Extract `convolink-companion-chrome.zip`.
2. Open `chrome://extensions` (or `brave://extensions` / `edge://extensions`).
3. Toggle on **Developer mode** in the top-right corner.
4. Click **Load unpacked** and select the extracted folder.

#### In Mozilla Firefox:
1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on...**
3. Select `convolink-companion-firefox.zip` (or `manifest.json` from the extracted folder).

---

## Option 2: Build From Source

Build native packages directly using Bun in seconds:
```bash
# Build both Chrome and Firefox extensions + generate ZIP release archives
bun run build:extension
```
Build outputs are generated in:
- Unpacked: `extensions/convolink-companion/.output/chrome-mv3` & `firefox-mv3`
- ZIP Archives: `extensions/convolink-companion/.output/convolink-companion-chrome.zip` & `firefox.zip`

The builder is the single source of truth: it reads the version from the root `package.json`, generates both manifests, and removes stale output before writing. There is no separate `manifest.json` or WXT build path to keep in sync.

---

## One-Time Pairing Handshake

To protect against local unauthorized processes, the extension uses a cryptographic pairing token:

1. Keep the bridge running in the background:
   ```bash
   convo daemon start
   ```
2. In your terminal, run:
   ```bash
   convo ext pair
   ```
3. Click the **ConvoLink Companion** icon in your browser extensions toolbar.
4. Paste the pairing token into the **Pairing Token** field.
5. Click **Save Settings & Connect**. The indicator turns green (**Bridge Connected**) and reconnects immediately.

Load unpacked from `extensions/convolink-companion/.output/chrome-mv3` (or the extracted zip), never from `extensions/convolink-companion` itself — the source folder has no manifest by design.

---

## CLI & MCP Usage

```bash
# Show bridge state and every connected browser/profile/version
bun run convo ext status

# Verify connection health across all connected browsers
bun run convo doctor

# List open AI tabs tagged by browser and profile
bun run convo list --transport extension-bridge

# Ask ChatGPT / DeepSeek / Claude / Gemini with automated artifact extraction
bun run convo ask --transport extension-bridge "Refactor this function to be pure"
```


## Protocol v2 and recovery

The companion speaks protocol v2. The bridge rejects older builds with `protocol-mismatch`; reload the unpacked extension after upgrading.

- The service worker heartbeats every 15 seconds and reconnects with exponential backoff (1s..30s) after a disconnect.
- Created tabs are tracked as ConvoLink-owned. The bridge will not close a tab the user opened.
- The extension executes a fixed operation set (probe, read, fill, click, key, navigate). It cannot run arbitrary JavaScript: MV3 content-script CSP blocks `eval()`, and MAIN-world injection inherits the page CSP. Unsupported probes fail loudly as `extension-unsupported`.
- If a platform changes its DOM, update `entrypoints/platforms.ts`; do not reintroduce eval.

### Which build is running?

Every build writes `build-meta.json` next to `background.js`. The service worker reads it at start, sends the identifier during the handshake, and the CLI prints it:

```bash
bun run convo ext status
#   • chrome [Personal] v1.2.1 · build mw0m7n5g · 2 tab(s)
```

**Chrome caches an unpacked extension's bundle in memory.** Restarting the service worker does not re-read `background.js`, so a rebuild only takes effect after:

1. `chrome://extensions`
2. **Reload** on the ConvoLink Companion card
3. `bun run convo ext status` shows the new identifier from `build-meta.json`

If the identifier differs from `.output/chrome-mv3/build-meta.json`, you are running an old bundle — unrelated behaviour differences are explained by that, not by the platform.

### Known platform issues

- **DeepSeek** can accept the prompt without mounting the transcript (`turns: 0`). Reloading
  the tab renders it. See `docs/EXTENSION_TRANSPORT_ISSUES.md`.
- **Gemini** renders inside a shadow root, so `DIAGNOSE` reports `sendFound: false` on a tab
  that works, and completion is the slowest in the fleet.

### Capability notes

- Typed input uses the browser input pipeline (`chrome.debugger`), because a DOM-only fill leaves the platform editor state empty and its send control ignores the click. If another debugger session is attached, the extension falls back to DOM injection and the fill is reported as not accepted.
- Screenshots need `<all_urls>` or a user gesture for `captureVisibleTab`. Without it the command returns `unsupported` with the reason; every other command keeps working.
- A tab created in a minimized or hidden window may never mount its conversation view (DeepSeek defers it). The extension restores the window and activates the tab for the duration of a wait.
