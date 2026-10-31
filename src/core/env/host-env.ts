import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * HostEnv resolves OS and user paths following XDG standards on Linux (Fedora-first),
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
    if (xdgData && xdgData.trim().length > 0) {
      return path.join(xdgData.trim(), this.APP_NAME);
    }
    return path.join(os.homedir(), ".local", "share", this.APP_NAME);
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
    const platform = os.platform();

    if (platform === "linux") {
      const candidates = [
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return p;
      }
    } else if (platform === "darwin") {
      const macPath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
      if (fs.existsSync(macPath)) return macPath;
    } else if (platform === "win32") {
      const programFiles = process.env["PROGRAMFILES"] || "C:\\Program Files";
      const programFilesX86 = process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";
      const winCandidates = [
        path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
        path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
      ];
      for (const p of winCandidates) {
        if (fs.existsSync(p)) return p;
      }
    }

    return null;
  }
}
