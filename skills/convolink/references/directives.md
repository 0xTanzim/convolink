# ConvoLink Artifact Directive Reference

This guide details how to construct prompts and parse code blocks to reliably generate multi-file projects using ConvoLink.

---

## 1. Directive Syntax Standard

ConvoLink scans assistant code blocks for directive headers on the first line. Supported styles:

### Single-Line Comments (Languages: TS, JS, Go, Rust, Java, C++, C#, Kotlin)
```typescript
// filepath: src/services/auth.service.ts
export class AuthService {
  // ...
}
```

### Hash Comments (Languages: Python, Bash, YAML, Ruby, Dockerfile, TOML)
```python
# filepath: api/endpoints.py
def get_user():
    pass
```

### Block Comments (Languages: CSS, SCSS, SQL, Solidity)
```css
/* filepath: styles/globals.css */
body {
  margin: 0;
}
```

### HTML / Markdown Comments (Languages: HTML, Markdown, Svelte, Vue)
```html
<!-- file: docs/ARCHITECTURE.md -->
# Architecture Overview
```

---

## 2. Directory Traversal Safeguards

ConvoLink strictly protects against path traversal vulnerabilities:
- Leading slashes (`/etc/passwd`) are stripped and resolved relative to the target output directory (`outDir`).
- Traversal sequences (`../`) are neutralized.
- If no directive is found, ConvoLink generates a deterministic sequential fallback:
  - `artifact-1.ts`
  - `artifact-2.py`
  - `artifact-3.json`

---

## 3. Recommended Multi-File Prompt Template

When querying an AI model to build or modify multiple files, use this prompt structure:

```text
Please implement the following feature across the necessary files.
For each file, output a separate code block with the relative file path on the very first line:
// filepath: path/to/file.ext (or # filepath: for python/shell/yaml)

Do not omit code or use placeholder comments. Provide complete implementations.
```

---

## 4. Execution Examples

### Single Command Artifact Output:
```bash
convo ask --platform chatgpt \
  "Write a complete CLI greeting tool in TypeScript with tests. Include // filepath: src/greet.ts and // filepath: tests/greet.test.ts" \
  --write-files \
  --out-dir ./src/tools
```

### Automatic Continuation for Large Artifacts:
When generating large codebases that exceed token output windows, ConvoLink automatically clicks the web model's "Continue" button and stitches consecutive chunks into unified files before writing to disk.
