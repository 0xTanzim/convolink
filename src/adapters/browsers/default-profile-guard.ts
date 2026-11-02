import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Chrome 136+ refuses a DevTools connection to the profile it started with
 * unless the user approves a modal, and even then the default data directory
 * stays blocked. Attaching anyway only produces that modal over and over, so the
 * endpoint is recognised and skipped instead.
 */
export const DEFAULT_PROFILE_DIRS = [
  ".config/google-chrome",
  ".config/chromium",
  ".config/BraveSoftware/Brave-Browser",
  ".config/microsoft-edge",
  ".config/google-chrome-beta",
] as const;

export const DEFAULT_PROFILE_BLOCK_MESSAGE =
  "this endpoint is the browser's default profile, which Chrome blocks from remote debugging even after approval";

export interface GuardOptions {
  readonly home?: string;
  readonly dirs?: readonly string[];
}

/** True when `port` belongs to a running browser on its default data directory. */
export function isDefaultProfileEndpoint(port: number, options: GuardOptions = {}): boolean {
  const home = options.home ?? os.homedir();
  const dirs = options.dirs ?? DEFAULT_PROFILE_DIRS;

  return dirs.some((dir) => {
    const marker = path.join(home, dir, "DevToolsActivePort");
    if (!fs.existsSync(marker)) return false;
    try {
      const advertised = Number(fs.readFileSync(marker, "utf8").split("\n")[0]?.trim());
      return advertised === port;
    } catch {
      return false;
    }
  });
}
