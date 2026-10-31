import fs from "node:fs";
import path from "node:path";
import type { ExtractedArtifact } from "./artifact.service.js";

export interface PersistOptions {
  readonly outDir: string;
  readonly overwrite?: boolean;
}

export interface WrittenFileRecord {
  readonly path: string;
  readonly relativePath: string;
  readonly bytes: number;
}

export interface SkippedFileRecord {
  readonly path: string;
  readonly relativePath: string;
  readonly reason: string;
}

export interface PersistResult {
  readonly writtenFiles: WrittenFileRecord[];
  readonly skippedFiles: SkippedFileRecord[];
}

export class WorkspaceFileSink {
  public async persist(
    artifacts: readonly ExtractedArtifact[],
    options: PersistOptions,
  ): Promise<PersistResult> {
    const writtenFiles: WrittenFileRecord[] = [];
    const skippedFiles: SkippedFileRecord[] = [];

    const targetBaseDir = path.resolve(options.outDir);

    for (const artifact of artifacts) {
      const fullPath = path.join(targetBaseDir, artifact.relativePath);

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
