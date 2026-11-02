import * as fs from "node:fs";
import type { ProcessProbe } from "../../core/ports/process.port.js";

/**
 * /proc is authoritative on Linux; `kill(pid, 0)` is the portable fallback for
 * minimal containers and other Unix hosts where /proc is not mounted. Neither
 * shells out, so there is no locale or busybox dependency.
 */
export class OsProcessProbe implements ProcessProbe {
  public isAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "EPERM";
    }
  }

  public cmdline(pid: number): string | null {
    try {
      return fs.readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").join(" ").trim() || null;
    } catch {
      return null;
    }
  }
}
