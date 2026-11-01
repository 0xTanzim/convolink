import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

export interface DiscoveredProfile {
  readonly browser: string;
  readonly profileId: string;
  readonly name: string;
  readonly email: string;
  readonly userDataDir: string;
  readonly devToolsPort?: number;
}

export interface ActivePortInfo {
  readonly port: number;
  readonly browserWsPath: string;
}

export class BrowserDiscoveryService {
  private readonly searchDirs: readonly string[];

  constructor(customDirs?: readonly string[]) {
    this.searchDirs = customDirs ?? BrowserDiscoveryService.getDefaultUserDataDirs();
  }

  public static getDefaultUserDataDirs(): string[] {
    const home = os.homedir();
    const dirs: string[] = [];

    // Automatically scan saved ConvoLink profiles (~/.config/convolink/profiles/*)
    const savedProfilesRoot = path.join(home, ".config/convolink/profiles");
    if (fs.existsSync(savedProfilesRoot)) {
      try {
        const subdirs = fs.readdirSync(savedProfilesRoot, { withFileTypes: true });
        for (const sub of subdirs) {
          if (sub.isDirectory() || sub.isSymbolicLink()) {
            dirs.push(path.join(savedProfilesRoot, sub.name));
          }
        }
      } catch {}
    }

    if (process.platform === "linux") {
      dirs.push(
        path.join(home, ".config/google-chrome"),
        path.join(home, ".config/chromium"),
        path.join(home, ".config/microsoft-edge"),
        path.join(home, ".config/BraveSoftware/Brave-Browser"),
        path.join(home, ".config/convolink/chrome-profile"),
      );
    } else if (process.platform === "darwin") {
      dirs.push(
        path.join(home, "Library/Application Support/Google/Chrome"),
        path.join(home, "Library/Application Support/Microsoft Edge"),
        path.join(home, "Library/Application Support/BraveSoftware/Brave-Browser"),
        path.join(home, "Library/Application Support/convolink/chrome-profile"),
      );
    } else if (process.platform === "win32") {
      const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData/Local");
      dirs.push(
        path.join(localAppData, "Google/Chrome/User Data"),
        path.join(localAppData, "Microsoft/Edge/User Data"),
        path.join(localAppData, "BraveSoftware/Brave-Browser/User Data"),
        path.join(localAppData, "convolink/chrome-profile"),
      );
    }
    return dirs;
  }

  public async readDevToolsActivePort(userDataDir: string): Promise<ActivePortInfo | null> {
    const portFile = path.join(userDataDir, "DevToolsActivePort");
    try {
      if (!fs.existsSync(portFile)) return null;
      const content = await fs.promises.readFile(portFile, "utf8");
      const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) return null;

      const rawPort = lines[0];
      const browserWsPath = lines[1];
      if (!rawPort || !browserWsPath) return null;

      const port = parseInt(rawPort, 10);
      if (isNaN(port) || port <= 0 || port > 65535) return null;

      return { port, browserWsPath };
    } catch {
      return null;
    }
  }

  public async discoverProfiles(): Promise<DiscoveredProfile[]> {
    const results: DiscoveredProfile[] = [];

    for (const dataDir of this.searchDirs) {
      if (!fs.existsSync(dataDir)) continue;

      const browserName = this.inferBrowserName(dataDir);
      const portInfo = await this.readDevToolsActivePort(dataDir);
      const localStateFile = path.join(dataDir, "Local State");

      if (fs.existsSync(localStateFile)) {
        try {
          const content = await fs.promises.readFile(localStateFile, "utf8");
          const parsed = JSON.parse(content);
          const infoCache = parsed?.profile?.info_cache;

          if (infoCache && typeof infoCache === "object") {
            for (const [profileId, info] of Object.entries(infoCache)) {
              const entry = info as Record<string, unknown>;
              results.push({
                browser: browserName,
                profileId,
                name: String(entry.name || profileId),
                email: String(entry.user_name || ""),
                userDataDir: dataDir,
                devToolsPort: portInfo?.port,
              });
            }
            continue;
          }
        } catch {}
      }

      // Fallback for profiles without Local State (e.g. custom persistent profile)
      results.push({
        browser: browserName,
        profileId: "Default",
        name: "Primary Profile",
        email: "",
        userDataDir: dataDir,
        devToolsPort: portInfo?.port,
      });
    }

    return results;
  }

  public async findActiveEndpoint(): Promise<{ endpoint: string; port: number } | null> {
    for (const dir of this.searchDirs) {
      const portInfo = await this.readDevToolsActivePort(dir);
      if (portInfo) {
        const isAlive = await this.checkPortAlive(portInfo.port);
        if (isAlive) {
          return { endpoint: `http://127.0.0.1:${portInfo.port}`, port: portInfo.port };
        }
      }
    }

    // Check standard fallback ports
    for (const port of [9222, 9229]) {
      const isAlive = await this.checkPortAlive(port);
      if (isAlive) {
        return { endpoint: `http://127.0.0.1:${port}`, port };
      }
    }

    return null;
  }

  private async checkPortAlive(port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(600),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private inferBrowserName(dirPath: string): string {
    const lower = dirPath.toLowerCase();
    if (lower.includes("convolink/profiles/")) {
      const base = path.basename(dirPath);
      return `ConvoLink Profile (${base})`;
    }
    if (lower.includes("edge")) return "Microsoft Edge";
    if (lower.includes("brave")) return "Brave";
    if (lower.includes("chromium")) return "Chromium";
    if (lower.includes("convolink")) return "ConvoLink Dedicated Profile";
    return "Google Chrome";
  }
}
