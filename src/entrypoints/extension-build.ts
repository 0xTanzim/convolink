import fs from "node:fs";
import path from "node:path";

export interface LoadedBuild {
  readonly buildId?: string;
  readonly profileLabel?: string;
}

const META_RELATIVE_PATH = path.join("extensions", "convolink-companion", ".output", "chrome-mv3", "build-meta.json");

/**
 * The bundle on disk is the only trustworthy source: Chrome caches the loaded
 * bundle, and a reload that races a rebuild leaves the service worker without
 * a build id at all.
 */
export function readExpectedBuildId(rootDir = path.resolve(import.meta.dir, "..", "..")): string | null {
  try {
    const raw = fs.readFileSync(path.join(rootDir, META_RELATIVE_PATH), "utf-8");
    const parsed = JSON.parse(raw) as { buildId?: string };
    return parsed.buildId ?? null;
  } catch {
    return null;
  }
}

/** Returns the warning to print, or null when every client runs the built bundle. */
export function describeBuildMismatch(clients: readonly LoadedBuild[], expected: string | null): string | null {
  if (!expected || clients.length === 0) return null;
  const stale = clients.filter((client) => client.buildId !== expected);
  if (stale.length === 0) return null;

  const loaded = stale.map((client) => client.buildId ?? "unreported").join(", ");
  return `build ${loaded} is running, but ${expected} is on disk — reload the Companion at chrome://extensions`;
}
