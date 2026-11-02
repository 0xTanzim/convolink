import * as fs from "node:fs";
import * as path from "node:path";

export interface ProfileLockState {
  readonly locked: boolean;
  readonly pid?: number;
  /** True when the process holding the profile was started with a debug port. */
  readonly debugging: boolean;
}

export interface InspectOptions {
  /** Injectable for tests; defaults to reading /proc on Linux. */
  readonly readCmdline?: (pid: number) => string | null;
  readonly exists?: (file: string) => boolean;
  readonly readlink?: (file: string) => string;
}

const DEBUG_FLAGS = ["--remote-debugging-port", "--marionette"];

/** The lock is a symlink whose target never exists, so existsSync would say "free". */
function linkExists(file: string): boolean {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function procCmdline(pid: number): string | null {
  try {
    return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ");
  } catch {
    return null;
  }
}

/**
 * Firefox locks a profile to a single process. Spawning a second instance on a
 * locked profile silently exits and leaves no debug port, which looks like a
 * ghost instance to the user. Detect the lock first so callers can explain it
 * instead of starting a doomed process.
 */
export function inspectFirefoxProfile(profileDir: string, options: InspectOptions = {}): ProfileLockState {
  const exists = options.exists ?? linkExists;
  const readlink = options.readlink ?? ((file: string) => fs.readlinkSync(file));
  const readCmdline = options.readCmdline ?? procCmdline;

  const lockFile = path.join(profileDir, "lock");
  if (!exists(lockFile)) return { locked: false, debugging: false };

  try {
    // Format: "<hostname>:+<pid>"
    const target = readlink(lockFile);
    const pid = Number(target.slice(target.lastIndexOf("+") + 1).replace(/[^0-9]/g, ""));
    if (!Number.isFinite(pid) || pid <= 0) return { locked: false, debugging: false };

    const cmdline = readCmdline(pid);
    if (!cmdline) return { locked: false, debugging: false };

    return { locked: true, pid, debugging: DEBUG_FLAGS.some((flag) => cmdline.includes(flag)) };
  } catch {
    return { locked: false, debugging: false };
  }
}
