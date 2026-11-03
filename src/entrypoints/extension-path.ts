import fs from "node:fs";
import path from "node:path";

/**
 * The unpacked Companion bundle only exists in a repository checkout. An npm
 * install ships `dist/` and `skills/` only, so printing a repo-shaped path there
 * would send the user to a folder that cannot exist.
 */
const EXT_RELATIVE_PATH = path.join("extensions", "convolink-companion", ".output", "chrome-mv3");

export function resolveExtensionUnpackedPath(bases: readonly string[] = [import.meta.dir]): string | null {
  for (const base of bases) {
    for (const candidate of [
      path.resolve(base, "..", "..", EXT_RELATIVE_PATH), // src/entrypoints -> repo root
      path.resolve(base, "..", EXT_RELATIVE_PATH), // dist -> package root
    ]) {
      if (isDirectory(candidate)) return candidate;
    }
  }
  return null;
}

function isDirectory(candidate: string): boolean {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}
