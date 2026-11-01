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

---

## One-Time Pairing Handshake

To protect against local unauthorized processes, the extension uses a cryptographic pairing token:

1. In your terminal, run:
   ```bash
   bun run convo ext pair
   ```
2. Click the **ConvoLink Companion** icon in your browser extensions toolbar.
3. Paste the pairing token into the **Pairing Token** field.
4. Click **Save Settings & Connect**. The indicator turns green (**Bridge Connected**).

---

## CLI & MCP Usage

```bash
# Verify connection health across all connected browsers
bun run convo doctor

# List open AI tabs tagged by browser and profile
bun run convo list --transport extension-bridge

# Ask ChatGPT / DeepSeek / Claude / Gemini with automated artifact extraction
bun run convo ask --transport extension-bridge "Refactor this function to be pure"
```
