import { describe, expect, it } from "bun:test";
import { ArtifactService } from "../../src/core/services/artifact.service.js";

describe("ArtifactService", () => {
  const service = new ArtifactService();

  it("extracts code blocks with explicit // filepath: directives", () => {
    const markdown = `
Here is the code:
\`\`\`typescript
// filepath: src/math.ts
export function add(a: number, b: number): number {
  return a + b;
}
\`\`\`
Done.`;

    const artifacts = service.extractArtifacts(markdown);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0]?.relativePath).toBe("src/math.ts");
    expect(artifacts[0]?.language).toBe("typescript");
    expect(artifacts[0]?.isExplicitPath).toBe(true);
    expect(artifacts[0]?.content).not.toContain("// filepath:");
    expect(artifacts[0]?.content).toContain("export function add");
  });

  it("extracts markdown blocks with <!-- file: --> directives", () => {
    const markdown = `
Here is the spec:
\`\`\`markdown
<!-- file: docs/SPEC.md -->
# System Specification
Details here.
\`\`\`
`;

    const artifacts = service.extractArtifacts(markdown);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0]?.relativePath).toBe("docs/SPEC.md");
    expect(artifacts[0]?.language).toBe("markdown");
    expect(artifacts[0]?.isExplicitPath).toBe(true);
    expect(artifacts[0]?.content).toContain("# System Specification");
  });

  it("generates deterministic fallback filenames when no directive is present", () => {
    const markdown = `
\`\`\`python
print("Hello Python")
\`\`\`

\`\`\`json
{"status": "ok"}
\`\`\`
`;

    const artifacts = service.extractArtifacts(markdown);
    expect(artifacts.length).toBe(2);
    expect(artifacts[0]?.relativePath).toBe("artifact-1.py");
    expect(artifacts[0]?.language).toBe("python");
    expect(artifacts[0]?.isExplicitPath).toBe(false);

    expect(artifacts[1]?.relativePath).toBe("artifact-2.json");
    expect(artifacts[1]?.language).toBe("json");
  });

  it("prevents directory traversal and sanitizes malicious paths", () => {
    const maliciousMarkdown = `
\`\`\`bash
// filepath: ../../../etc/passwd
echo "hack"
\`\`\`
`;

    const artifacts = service.extractArtifacts(maliciousMarkdown);
    expect(artifacts.length).toBe(1);
    expect(artifacts[0]?.relativePath).not.toContain("..");
    expect(artifacts[0]?.relativePath.startsWith("/")).toBe(false);
    expect(artifacts[0]?.relativePath).toBe("etc/passwd");
  });

  it("does not produce duplicate artifacts when codeBlocks and markdown contain the same blocks", () => {
    const markdown = `
\`\`\`typescript
export function one() { return 1; }
\`\`\`
\`\`\`python
def two(): return 2
\`\`\`
`;
    const codeBlocks = [
      { language: "typescript", code: "export function one() { return 1; }" },
      { language: "python", code: "def two(): return 2" },
    ];

    const artifacts = service.extractArtifacts(markdown, codeBlocks);
    // Should extract exactly 2 artifacts, not 4 (no duplicates)
    expect(artifacts.length).toBe(2);
    expect(artifacts.map((a) => a.relativePath)).toEqual(["artifact-1.ts", "artifact-2.py"]);
  });
});
