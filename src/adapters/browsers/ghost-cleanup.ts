import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

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

  public async killGhostProcesses(): Promise<number> {
    if (process.platform === "win32") return 0;

    let killed = 0;
    try {
      // Find chrome processes with ghost profile arguments
      const pgrep = Bun.spawn(["pgrep", "-a", "chrome"], { stdout: "pipe" });
      const output = await new Response(pgrep.stdout).text();
      const lines = output.split("\n").filter(Boolean);

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parseInt(parts[0] || "", 10);
        if (isNaN(pid) || pid <= 0) continue;

        const cmdLine = line.slice(parts[0]?.length || 0).trim();
        if (
          cmdLine.includes("convolink/chrome-profile") ||
          cmdLine.includes("chrome-debug") ||
          cmdLine.includes("puppeteer_dev_chrome_profile")
        ) {
          try {
            process.kill(pid, "SIGTERM");
            killed++;
          } catch {}
        }
      }
    } catch {}
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
