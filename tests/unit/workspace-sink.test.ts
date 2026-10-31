import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { WorkspaceFileSink } from "../../src/core/services/workspace-sink.service.js";
import type { ExtractedArtifact } from "../../src/core/services/artifact.service.js";

describe("WorkspaceFileSink", () => {
  const tmpDir = path.join(os.tmpdir(), `omni-sink-test-${Date.now()}`);
  const sink = new WorkspaceFileSink();

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
});
