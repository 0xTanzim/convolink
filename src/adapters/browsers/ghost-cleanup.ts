import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { OsProcessProbe } from "./process-probe.js";
import { readBrowserRecords, removeBrowserRecord } from "./browser-records.js";
import type { ProcessProbe } from "../../core/ports/process.port.js";

export class GhostCleanupService {
  private static readonly GHOST_PATTERNS = [
    /convolink[\\/](chrome|firefox)-profile/i,
    /convolink[\\/]profiles[\\/].*-dev/i,
    /convolink-(ghost|firefox-test)/i,
    /(chrome|firefox)-debug/i,
    /puppeteer_dev_chrome_profile/i,
  ];

  public isGhostPath(dirPath: string): boolean {
    const normalized = path.normalize(dirPath);
    // Never allow real user config directories to be flagged as ghost
    if (this.isRealUserProfile(normalized)) return false;

    return GhostCleanupService.GHOST_PATTERNS.some((pattern) => pattern.test(normalized));
  }

  public async purgeGhostDirectories(candidateDirs?: readonly string[]): Promise<string[]> {
    const targets = candidateDirs ?? this.getDefaultGhostLocations();
    const purged: string[] = [];

    for (const dir of targets) {
      if (!this.isGhostPath(dir)) continue;

      if (fs.existsSync(dir)) {
        try {
          await fs.promises.rm(dir, { recursive: true, force: true });
          purged.push(dir);
        } catch {}
      }
    }
    return purged;
  }

  /**
   * Only processes ConvoLink recorded when it launched them are candidates.
   * Scanning every browser process is how a cleanup command kills the user's
   * real window, so the record — not a name match — is the permission slip.
   */
  public async killGhostProcesses(
    probe: ProcessProbe = new OsProcessProbe(),
    kill: (pid: number) => void = (pid) => process.kill(pid, "SIGKILL"),
  ): Promise<number> {
    let killed = 0;
    for (const record of readBrowserRecords()) {
      if (!probe.isAlive(record.pid)) {
        removeBrowserRecord(record.profilePath);
        continue;
      }
      const cmdline = probe.cmdline(record.pid) ?? "";
      if (!cmdline.includes(record.profilePath) && !this.isGhostPath(record.profilePath)) continue;
      try {
        kill(record.pid);
        killed += 1;
      } catch {}
      removeBrowserRecord(record.profilePath);
    }
    return killed;
  }

  private isRealUserProfile(dirPath: string): boolean {
    const lower = dirPath.toLowerCase();
    const home = os.homedir().toLowerCase();
    const realChrome = path.join(home, ".config/google-chrome").toLowerCase();
    const realEdge = path.join(home, ".config/microsoft-edge").toLowerCase();
    const realBrave = path.join(home, ".config/bravesoftware").toLowerCase();
    const realChromium = path.join(home, ".config/chromium").toLowerCase();
    const savedProfiles = path.join(home, ".config/convolink/profiles").toLowerCase();

    return (
      lower === realChrome ||
      lower === realEdge ||
      lower === realBrave ||
      lower === realChromium ||
      lower.startsWith(realChrome + path.sep) ||
      lower.startsWith(realEdge + path.sep) ||
      lower.startsWith(savedProfiles)
    );
  }

  private getDefaultGhostLocations(): string[] {
    const home = os.homedir();
    const tmp = os.tmpdir();
    return [
      path.join(home, ".config/convolink/chrome-profile"),
      path.join(tmp, "chrome-debug"),
      path.join(tmp, "convolink-ghost"),
    ];
  }
}
