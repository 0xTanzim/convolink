---
name: convo
description: Alias of the convolink skill for harnesses that key on the CLI name. Use when the user says "convo", "convolink", or asks to drive their logged-in browser with a web model. Read skills/convolink/SKILL.md — it is the single source of truth.
license: MIT
compatibility: claude-code, cursor, codex, opencode, antigravity, windsurf
---

# ConvoLink (alias)

This skill exists only because some harnesses index by the CLI name `convo`. The content
lives in [`skills/convolink/SKILL.md`](../convolink/SKILL.md); do not maintain a second copy.

Install the real one with:

```bash
convo skill install --harness <opencode|claude|cursor|codex|antigravity>
```

Then start every session with:

```bash
convo onboard --json
```
