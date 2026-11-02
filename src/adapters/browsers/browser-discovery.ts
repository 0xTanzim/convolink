import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import * as net from "node:net";
import { parseGeckoProfiles } from "./gecko-profiles.js";

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
    if (process.platform === "linux") {
      dirs.push(...[".config/google-chrome", ".config/chromium", ".config/microsoft-edge", ".config/BraveSoftware/Brave-Browser", ".mozilla/firefox", ".config/zen", ".zen", ".config/convolink/chrome-profile"].map((p) => path.join(home, p)));
    } else if (process.platform === "darwin") {
      dirs.push(...["Library/Application Support/Google/Chrome", "Library/Application Support/Microsoft Edge", "Library/Application Support/BraveSoftware/Brave-Browser", "Library/Application Support/Firefox", "Library/Application Support/zen", "Library/Application Support/Zen Browser", "Library/Application Support/convolink/chrome-profile"].map((p) => path.join(home, p)));
    } else if (process.platform === "win32") {
      const local = process.env.LOCALAPPDATA || path.join(home, "AppData/Local");
      const roaming = process.env.APPDATA || path.join(home, "AppData/Roaming");
      dirs.push(path.join(local, "Google/Chrome/User Data"), path.join(local, "Microsoft/Edge/User Data"), path.join(local, "BraveSoftware/Brave-Browser/User Data"), path.join(roaming, "Mozilla/Firefox"), path.join(roaming, "zen"), path.join(roaming, "Zen Browser"), path.join(local, "convolink/chrome-profile"));
    }

    // Secondary fallback: saved custom ConvoLink profiles (~/.config/convolink/profiles/*)
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

      const profilesIni = path.join(dataDir, "profiles.ini");
      if (fs.existsSync(profilesIni)) {
        const geckoProfiles = await parseGeckoProfiles(dataDir, browserName);
        results.push(...geckoProfiles);
        continue;
      }

      const localStateFile = path.join(dataDir, "Local State");

      if (fs.existsSync(localStateFile)) {
        try {
          const content = await fs.promises.readFile(localStateFile, "utf8");
          const parsed = JSON.parse(content);
          const infoCache = parsed?.profile?.info_cache;

          if (infoCache && typeof infoCache === "object") {
            for (const [profileId, info] of Object.entries(infoCache)) {
              const entry = info as Record<string, unknown>;
              const resolvedId = dataDir.toLowerCase().includes("convolink/profiles/")
                ? path.basename(dataDir)
                : profileId;
              results.push({
                browser: browserName,
                profileId: resolvedId,
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

  public async getProfilesForBrowser(browserName?: string): Promise<DiscoveredProfile[]> {
    const all = await this.discoverProfiles();
    if (!browserName || browserName === "auto" || browserName === "any") return all;
    const lower = browserName.toLowerCase();
    return all.filter((p) => p.browser.toLowerCase().includes(lower));
  }

  public async findActiveEndpoint(): Promise<{ endpoint: string; port: number; browserWsPath?: string } | null> {
    for (const dir of this.searchDirs) {
      const portInfo = await this.readDevToolsActivePort(dir);
      if (portInfo) {
        const isAlive = await this.checkPortAlive(portInfo.port);
        if (isAlive) {
          return { endpoint: `http://127.0.0.1:${portInfo.port}`, port: portInfo.port, browserWsPath: portInfo.browserWsPath };
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
    return new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.setTimeout(250);
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.on("error", () => {
        socket.destroy();
        resolve(false);
      });
    });
  }

  private inferBrowserName(dirPath: string): string {
    const lower = dirPath.toLowerCase();
    if (lower.includes("zen")) return "Zen Browser";
    if (lower.includes("firefox") || lower.includes("mozilla")) return "Firefox";
    if (lower.includes("edge")) return "Microsoft Edge";
    if (lower.includes("brave")) return "Brave";
    if (lower.includes("chromium")) return "Chromium";
    return "Google Chrome";
  }
}
