# ConvoLink Project Brief

## 1. Executive Summary

**Project Name:** ConvoLink (`convolink` / `convo`)  
**Product Category:** Cognitive Continuity Runtime & Cross-Browser AI Orchestration  
**Primary Users:** Software Engineers, Autonomous Coding Agents (Claude Code, Cursor, Antigravity, OpenCode)

---

## 2. Problem Statement: The "Dual-Brain Amnesia" Gap

Software engineers routinely conduct deep architectural explorations, debugging sessions, and trade-off analyses using authenticated web AI interfaces (ChatGPT Plus/Pro, DeepSeek R1, Google Gemini Advanced). These web sessions represent hours of refined context, extensive reasoning, and unmetered compute.

However, when an engineer transitions to their local terminal to execute changes, their autonomous coding agent operates with total amnesia. The developer is reduced to a manual clipboard—copying plans from the browser to the terminal and pasting compile errors back into the browser.

Existing automation tools fall short because they:
- Launch ephemeral, logged-out browser instances with separate profiles.
- Destroy code indentation and formatting through naive text scraping.
- Terminate during long silent thinking intervals in reasoning models.
- Steal OS desktop focus with jarring `bringToFront()` calls.
- Require high-cost metered API tokens for models the user already pays subscriptions for.

---

## 3. Product Vision & Solutions

ConvoLink transforms authenticated browser tabs into an active, stateful intelligence layer for local workflows:

1. **Direct Session Connection:** Connects via Chrome DevTools Protocol (CDP) or W3C WebDriver BiDi to the developer's live browser tabs without spawning new profiles or stealing window focus.
2. **Multi-Model Comparison & Arbitration:** Broadcasts prompts simultaneously across ChatGPT, DeepSeek, and Gemini, benchmarks response latency and code volume, and synthesizes a unified consensus solution via a Technical Arbiter.
3. **Automated Multi-File Artifact Extraction:** Automatically parses `// filepath:` directives and writes structured files directly to the local filesystem.
4. **Autonomous Stream Continuation:** Clicks "Continue generating" and stitches multi-chunk stream completions seamlessly without human intervention.
5. **Durable Local Ledger:** Persists conversation turns, extracted code blocks, and context packets in a local SQLite database for instant resumption and documentation export.
6. **Unified Agent Access:** Exposes capabilities both as a sub-second terminal CLI (`convo`) and as a native Model Context Protocol (MCP) server over standard I/O.
