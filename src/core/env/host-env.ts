import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserLocator } from "./browser-locator.js";

/**
 * HostEnv resolves OS and user paths following XDG standards on Linux,
 * with clean fallbacks for macOS and Windows.
 */
export class HostEnv {
  private static readonly APP_NAME = "convolink";

  /**
   * Resolves the runtime lock directory. On Linux, this prefers $XDG_RUNTIME_DIR
   * which mounts on tmpfs (RAM), preventing disk wear and auto-clearing on reboot.
   */
  public static getLockDir(): string {
    const xdgRuntime = process.env.XDG_RUNTIME_DIR;
    if (xdgRuntime && xdgRuntime.trim().length > 0) {
      return path.join(xdgRuntime.trim(), this.APP_NAME);
    }
    return path.join(os.tmpdir(), this.APP_NAME);
  }

  /**
   * Resolves the persistent data storage directory (SQLite ledgers, configs).
   */
  public static getDataDir(): string {
    const xdgData = process.env.XDG_DATA_HOME;
    if (xdgData && xdgData.trim().length > 0 && xdgData.trim() !== "undefined") {
      return path.join(xdgData.trim(), this.APP_NAME);
    }
    return path.join(os.homedir(), ".local", "share", this.APP_NAME);
  }

  /**
   * Resolves the persistent configuration directory (~/.config/convolink or $XDG_CONFIG_HOME/convolink).
   */
  public static getConfigDir(): string {
    const xdgConfig = process.env.XDG_CONFIG_HOME;
    if (xdgConfig && xdgConfig.trim().length > 0 && xdgConfig.trim() !== "undefined") {
      return path.join(xdgConfig.trim(), this.APP_NAME);
    }
    return path.join(os.homedir(), ".config", this.APP_NAME);
  }

  /**
   * Resolves the deterministic path to the local bridge pairing token file.
   */
  public static getBridgeTokenPath(): string {
    return path.join(this.getConfigDir(), "bridge-token.json");
  }

  /**
   * Formats a deterministic mutex lockfile path for a browser tab.
   */
  public static getTabLockPath(targetId: string): string {
    const sanitized = targetId.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.getLockDir(), `tab-${sanitized}.lock`);
  }

  /**
   * Ensures that runtime directories exist with appropriate permissions.
   */
  public static ensureDirs(): void {
    const lockDir = this.getLockDir();
    if (!fs.existsSync(lockDir)) {
      fs.mkdirSync(lockDir, { recursive: true, mode: 0o700 });
    }

    const dataDir = this.getDataDir();
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    }
  }

  /**
   * Locates Google Chrome or Chromium executable on the host system.
   */
  public static findChromeExecutable(): string | null {
    return BrowserLocator.findChromeExecutable();
  }

  /**
   * Locates a browser executable dynamically based on browser name (Brave, Edge, Chrome, Chromium).
   */
  public static findBrowserExecutable(browserName = "Google Chrome"): string | null {
    return BrowserLocator.findBrowserExecutable(browserName);
  }
}
