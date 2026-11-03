import fs from "node:fs";
import path from "node:path";

// Injected by scripts/build-dist.ts so the published bundle carries the released
// version without shipping package.json inside dist/.
declare const __CONVOLINK_VERSION__: string | undefined;

const DEVELOPMENT_FALLBACK = "0.0.0-dev";

export function resolveCliVersion(): string {
  if (typeof __CONVOLINK_VERSION__ === "string" && __CONVOLINK_VERSION__) {
    return __CONVOLINK_VERSION__;
  }
  try {
    const pkgPath = path.resolve(import.meta.dir, "../../package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
    return pkg.version ?? DEVELOPMENT_FALLBACK;
  } catch {
    return DEVELOPMENT_FALLBACK;
  }
}

const VERSION_COMMANDS = new Set(["--version", "-v", "version"]);

/** Returns the exit code when the invocation asks only for the version, else null. */
export function handleVersionCommand(command: string): number | null {
  if (!VERSION_COMMANDS.has(command)) return null;
  process.stdout.write(`convolink ${resolveCliVersion()}\n`);
  return 0;
}
