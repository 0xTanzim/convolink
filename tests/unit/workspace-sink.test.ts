import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkspaceFileSinkAdapter } from "../../src/adapters/storage/workspace-sink.adapter.js";
import type { ExtractedArtifact } from "../../src/core/services/artifact.service.js";

describe("WorkspaceFileSinkAdapter", () => {
  const tmpDir = path.join(os.tmpdir(), `convo-sink-test-${Date.now()}`);
  const sink = new WorkspaceFileSinkAdapter();

  it("writes artifacts to disk creating nested parent directories", async () => {
    const artifacts: ExtractedArtifact[] = [
      {
        relativePath: "src/utils/calculator.ts",
        language: "typescript",
        content: "export const PI = 3.14;",
        isExplicitPath: true,
      },
      {
        relativePath: "README.md",
        language: "markdown",
        content: "# Test Project",
        isExplicitPath: true,
      },
    ];

    const result = await sink.persist(artifacts, { outDir: tmpDir, overwrite: true });

    expect(result.writtenFiles.length).toBe(2);
    expect(fs.existsSync(path.join(tmpDir, "src/utils/calculator.ts"))).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, "src/utils/calculator.ts"), "utf8")).toBe("export const PI = 3.14;");
    expect(fs.existsSync(path.join(tmpDir, "README.md"))).toBe(true);
  });

  it("respects overwrite: false and skips existing files safely", async () => {
    const artifacts: ExtractedArtifact[] = [
      {
        relativePath: "README.md",
        language: "markdown",
        content: "# New Content",
        isExplicitPath: true,
      },
    ];

    const result = await sink.persist(artifacts, { outDir: tmpDir, overwrite: false });

    expect(result.skippedFiles.length).toBe(1);
    expect(result.skippedFiles[0]?.reason).toContain("already exists");
    expect(fs.readFileSync(path.join(tmpDir, "README.md"), "utf8")).toBe("# Test Project");
  });

  it("rejects path traversal attempts outside target directory", async () => {
    const artifacts: ExtractedArtifact[] = [
      {
        relativePath: "../../etc/evil.sh",
        language: "bash",
        content: "rm -rf /",
        isExplicitPath: true,
      },
      {
        relativePath: "/etc/passwd",
        language: "text",
        content: "root:x:0:0",
        isExplicitPath: true,
      },
      {
        relativePath: "safe/child.ts",
        language: "typescript",
        content: "export const safe = true;",
        isExplicitPath: true,
      },
    ];

    const result = await sink.persist(artifacts, { outDir: tmpDir, overwrite: true });

    expect(result.skippedFiles.length).toBe(2);
    expect(result.skippedFiles[0]?.reason).toContain("Path traversal detected");
    expect(result.skippedFiles[1]?.reason).toContain("Path traversal detected");
    expect(result.writtenFiles.length).toBe(1);
    expect(fs.existsSync(path.join(tmpDir, "safe/child.ts"))).toBe(true);
  });
});
