# ConvoLink Browser Automation Reference: Firefox, Zen Browser & Chromium

ConvoLink supports both the **Gecko engine** (Mozilla Firefox, Zen Browser) and the **Chromium engine** (Google Chrome, Brave, Microsoft Edge, Chromium).

---

## 1. Supported Browsers & Transports

| Browser | Engine | Recommended Transport | Port | Direct Dev Transport | Port |
|---|---|---|---|---|---|
| **Mozilla Firefox** | Gecko | `extension-bridge` | `9224` | `firefox-bidi` | `9223` |
| **Zen Browser** | Gecko | `extension-bridge` | `9224` | `firefox-bidi` | `9223` |
| **Google Chrome** | Chromium | `extension-bridge` | `9224` | `raw-cdp` | `9222` |
| **Brave Browser** | Chromium | `extension-bridge` | `9224` | `raw-cdp` | `9222` |
| **Microsoft Edge** | Chromium | `extension-bridge` | `9224` | `raw-cdp` | `9222` |
| **Chromium** | Chromium | `extension-bridge` | `9224` | `raw-cdp` | `9222` |

> **Recommendation:** Always default to `extension-bridge`. It operates seamlessly inside the user's everyday logged-in browser session across all platforms without debug flags, session lockouts, or profile duplication.

---

## 2. Gecko Engine: Firefox & Zen Browser

### Profile Auto-Discovery
ConvoLink parses `profiles.ini` to discover profiles and extract signed-in user emails:

- **Firefox Locations:**
  - Linux: `~/.mozilla/firefox/profiles.ini`
  - macOS: `~/Library/Application Support/Firefox/profiles.ini`
  - Windows: `%APPDATA%\Mozilla\Firefox\profiles.ini`
- **Zen Browser Locations:**
  - Linux (Native): `~/.zen/profiles.ini`
  - Linux (Flatpak): `~/.var/app/app.zen_browser.zen/.zen/profiles.ini`
  - macOS: `~/Library/Application Support/zen/profiles.ini`
  - Windows: `%APPDATA%\zen\profiles.ini`

### Companion Extension Installation (Firefox & Zen)
1. Run `convo ext pair` (or check `convo onboard --json`) to retrieve the 32-byte cryptographic pairing token.
2. In Firefox or Zen Browser, navigate to:
   ```text
   about:debugging#/runtime/this-firefox
   ```
3. Click **"Load Temporary Add-on..."**.
4. Browse to your ConvoLink installation and select:
   ```text
   extensions/convolink-companion/.output/firefox-mv3/manifest.json
   ```
   *(or the packaged `convolink-companion-firefox-v1.3.0.zip`)*.
5. Click the ConvoLink Companion puzzle icon in the browser toolbar, paste the pairing token, and click **Connect**.
6. ConvoLink is now linked to your live Firefox or Zen session.

### Direct Debugging Port (Alternative: Dev Profile)
If running a dedicated automation profile without the extension:
```bash
# Launch Firefox with WebDriver BiDi remote debugging port
firefox --remote-debugging-port 9223 -P <profile-name>

# Launch Zen Browser with WebDriver BiDi remote debugging port
zen --remote-debugging-port 9223 -P <profile-name>
```

### Zen Browser Hibernated Workspaces & Tab Visibility
Zen Browser employs aggressive tab unloading and workspace separation:
- **BiDi Transport (`:9223`):** W3C WebDriver BiDi only enumerates awake/active browsing contexts. Dormant tabs in inactive workspaces do not appear in `convo_list_tabs`. However, calling `convo ask -p deepseek "..."` will automatically create a new tab if no awake tab is found.
- **Extension Bridge (`:9224`, Recommended):** Uses WebExtensions `browser.tabs.query({})`, retaining visibility across all workspaces even when tabs are unloaded.
- **Single-Session Daemon Invariant:** Gecko WebDriver BiDi strictly enforces `max_sessions: 1`. ConvoLink automatically routes all agent and CLI access through the persistent ConvoLink Daemon to prevent session contention and port conflicts.
Then configure ConvoLink:
```bash
convo setup --browser zen --transport firefox-bidi --port 9223 --save-only
```

---

## 3. Chromium Engine: Chrome, Brave, Edge

### Companion Extension Installation (Chrome, Brave, Edge)
1. Run `convo ext pair` to obtain the token.
2. In Chrome, Brave, or Edge, navigate to:
   ```text
   chrome://extensions
   ```
3. Enable **Developer mode** (toggle in top-right corner).
4. Click **Load unpacked** and select:
   ```text
   extensions/convolink-companion/.output/chrome-mv3
   ```
5. Click the ConvoLink toolbar icon, paste the token, and click **Connect**.

### Direct CDP Debugging Port (Alternative: Dev Profile)
> **Note:** Starting in Chrome 136+, connecting direct CDP to the default user profile is blocked by Chromium security. Direct CDP requires a separate dedicated directory:
```bash
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/convo-chrome-dev
```
Then configure ConvoLink:
```bash
convo setup --browser chrome --transport raw-cdp --port 9222 --save-only
```

---

## 4. Setup Commands Matrix

### CLI Declarative Setup
```bash
# Mozilla Firefox (Extension Bridge)
convo setup --browser firefox --transport extension-bridge --save-only

# Zen Browser (Extension Bridge)
convo setup --browser zen --transport extension-bridge --save-only

# Zen Browser (WebDriver BiDi Direct Port)
convo setup --browser zen --transport firefox-bidi --port 9223 --save-only

# Google Chrome (Extension Bridge)
convo setup --browser chrome --transport extension-bridge --save-only

# Brave Browser (Extension Bridge)
convo setup --browser brave --transport extension-bridge --save-only
```

### MCP Declarative Setup
```typescript
// Configure Zen Browser via MCP
await convo_setup({
  browser: "zen",
  transport: "extension-bridge",
  saveOnly: true,
});

// Configure Firefox via MCP
await convo_setup({
  browser: "firefox",
  transport: "extension-bridge",
  saveOnly: true,
});
```
