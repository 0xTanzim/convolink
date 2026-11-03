import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { resolveExtensionUnpackedPath } from "../../src/entrypoints/extension-path.js";

describe("Extension unpacked path", () => {
  it("finds the built bundle in the repository", () => {
    const found = resolveExtensionUnpackedPath();
    expect(found).not.toBeNull();
    expect(found!.endsWith(path.join(".output", "chrome-mv3"))).toBe(true);
  });

  it("returns null when no bundle is present, instead of inventing a path", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "convo-noext-"));
    try {
      expect(resolveExtensionUnpackedPath([empty])).toBeNull();
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});
