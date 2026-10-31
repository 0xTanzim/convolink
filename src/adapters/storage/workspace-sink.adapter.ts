import fs from "node:fs";
import path from "node:path";
import type {
  CodeArtifact,
  PersistOptions,
  PersistResult,
  SkippedFileRecord,
  WorkspaceSinkPort,
  WrittenFileRecord,
} from "../../core/ports/storage.port.js";

export class WorkspaceFileSinkAdapter implements WorkspaceSinkPort {
  public async persist(
    artifacts: readonly CodeArtifact[],
    options: PersistOptions,
  ): Promise<PersistResult> {
    const writtenFiles: WrittenFileRecord[] = [];
    const skippedFiles: SkippedFileRecord[] = [];

    const targetBaseDir = path.resolve(options.outDir);
    const targetBasePrefix = targetBaseDir.endsWith(path.sep)
      ? targetBaseDir
      : `${targetBaseDir}${path.sep}`;

    for (const artifact of artifacts) {
      const fullPath = path.resolve(targetBaseDir, artifact.relativePath);

      // Path traversal containment check (F01 / MAT-02)
      if (!fullPath.startsWith(targetBasePrefix)) {
        skippedFiles.push({
          path: fullPath,
          relativePath: artifact.relativePath,
          reason: "Security violation: Path traversal detected outside target base directory",
        });
        continue;
      }

      if (fs.existsSync(fullPath) && !options.overwrite) {
        skippedFiles.push({
          path: fullPath,
          relativePath: artifact.relativePath,
          reason: "File already exists and overwrite is disabled",
        });
        continue;
      }

      const parentDir = path.dirname(fullPath);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }

      const buffer = Buffer.from(artifact.content, "utf8");
      fs.writeFileSync(fullPath, buffer);

      writtenFiles.push({
        path: fullPath,
        relativePath: artifact.relativePath,
        bytes: buffer.byteLength,
      });
    }

    return {
      writtenFiles,
      skippedFiles,
    };
  }
}

export { WorkspaceFileSinkAdapter as WorkspaceFileSink };
