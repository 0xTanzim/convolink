import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveExtensionUnpackedPath } from "../../src/entrypoints/extension-path.js";

/** Builds a directory tree shaped like a repository checkout or an npm package. */
function withTree(relativeBundle: string, run: (base: string, bundle: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "convo-ext-path-"));
  const bundle = path.join(root, relativeBundle);
  fs.mkdirSync(bundle, { recursive: true });
  try {
    run(root, bundle);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe("Extension unpacked path", () => {
  it("finds the bundle two levels above src/entrypoints", () => {
    withTree(path.join("extensions", "convolink-companion", ".output", "chrome-mv3"), (root, bundle) => {
      expect(resolveExtensionUnpackedPath([path.join(root, "src", "entrypoints")])).toBe(bundle);
    });
  });

  it("finds the bundle one level above dist", () => {
    withTree(path.join("extensions", "convolink-companion", ".output", "chrome-mv3"), (root, bundle) => {
      expect(resolveExtensionUnpackedPath([path.join(root, "dist")])).toBe(bundle);
    });
  });

  it("returns null instead of inventing a path when no bundle is installed", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "convo-noext-"));
    try {
      expect(resolveExtensionUnpackedPath([empty])).toBeNull();
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
