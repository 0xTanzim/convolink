# ConvoLink Chrome Companion Extension

The **ConvoLink Companion** extension provides a **100% zero-flag, authenticated CDP connection** between your everyday Google Chrome profile and local AI coding agents.

## Why this exists
- In modern Chrome (136+), passing `--remote-debugging-port` against the default Chrome profile is blocked for security reasons.
- Launching Chrome with a custom `--user-data-dir` creates an empty "ghost browser" where you are logged out of your Google account, ChatGPT, Claude, and Gemini.
- This extension runs inside your **real, everyday Chrome profile**, giving ConvoLink access to your open AI tabs with full authentication, cookies, and context. Zero browser restarts and zero command-line flags required.

## 1-Minute Installation
1. Open Google Chrome.
2. In the address bar, go to `chrome://extensions/`.
3. Enable **Developer mode** (toggle switch in the top right corner).
4. Click **Load unpacked** (top left).
5. Select this folder: `extensions/convolink-companion`.
6. That's it! When you run `convo doctor` or `convo ask --transport extension-bridge`, ConvoLink connects directly to your active Chrome tabs.
