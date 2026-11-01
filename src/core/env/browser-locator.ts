import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface BrowserLocatorOptions {
  platform?: NodeJS.Platform;
  arch?: string;
  env?: Record<string, string | undefined>;
  fileExists?: (path: string) => boolean;
}

/**
 * Cross-platform browser executable locator with Linux ARM64, Flatpak,
 * Snap, macOS, and Windows LocalAppData/ProgramFiles support.
 */
export class BrowserLocator {
  public static findChromeExecutable(options: BrowserLocatorOptions = {}): string | null {
    return this.findBrowserExecutable("Google Chrome", options);
  }

  public static findBrowserExecutable(
    browserName = "Google Chrome",
    options: BrowserLocatorOptions = {},
  ): string | null {
    const fileExists = options.fileExists ?? fs.existsSync;
    if (browserName.toLowerCase() === "any") {
      return this.findAnyInstalledBrowser(options);
    }
    const candidates = this.getCandidatePaths(browserName, options);
    for (const candidate of candidates) {
      if (fileExists(candidate)) return candidate;
    }
    return null;
  }

  public static findAnyInstalledBrowser(options: BrowserLocatorOptions = {}): string | null {
    const browsers = ["Google Chrome", "Brave", "Microsoft Edge", "Chromium"];
    for (const b of browsers) {
      const found = this.findBrowserExecutable(b, options);
      if (found) return found;
    }
    return null;
  }

  public static getCandidatePaths(
    browserName: string,
    options: BrowserLocatorOptions = {},
  ): string[] {
    const platform = options.platform ?? os.platform();
    const arch = options.arch ?? os.arch();
    const env = options.env ?? process.env;
    const lower = browserName.toLowerCase();

    if (platform === "linux") {
      return this.getLinuxCandidates(lower, arch);
    }
    if (platform === "darwin") {
      return this.getDarwinCandidates(lower, env);
    }
    if (platform === "win32") {
      return this.getWindowsCandidates(lower, env);
    }
    return [];
  }

  private static getLinuxCandidates(lower: string, arch: string): string[] {
    const isArm = arch === "arm64" || arch === "aarch64";
    if (lower.includes("brave")) {
      return [
        "/usr/bin/brave-browser",
        "/usr/bin/brave-browser-stable",
        "/usr/bin/brave",
        "/snap/bin/brave",
        "/var/lib/flatpak/exports/bin/com.brave.Browser",
      ];
    }
    if (lower.includes("edge")) {
      return [
        "/usr/bin/microsoft-edge",
        "/usr/bin/microsoft-edge-stable",
        "/usr/bin/microsoft-edge-dev",
        "/var/lib/flatpak/exports/bin/com.microsoft.Edge",
      ];
    }
    const chromiumList = [
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/snap/bin/chromium",
      "/var/lib/flatpak/exports/bin/org.chromium.Chromium",
      "/run/current-system/sw/bin/chromium",
    ];
    const chromeList = [
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/snap/bin/google-chrome",
      "/var/lib/flatpak/exports/bin/com.google.Chrome",
      "/run/current-system/sw/bin/google-chrome",
    ];
    return isArm ? [...chromiumList, ...chromeList] : [...chromeList, ...chromiumList];
  }

  private static getDarwinCandidates(
    lower: string,
    env: Record<string, string | undefined>,
  ): string[] {
    const home = env.HOME || os.homedir();
    const roots = ["/Applications", path.join(home, "Applications")];
    let appName = "Google Chrome.app/Contents/MacOS/Google Chrome";
    let extra: string[] = [];

    if (lower.includes("brave")) {
      appName = "Brave Browser.app/Contents/MacOS/Brave Browser";
    } else if (lower.includes("edge")) {
      appName = "Microsoft Edge.app/Contents/MacOS/Microsoft Edge";
    } else if (lower.includes("arc")) {
      appName = "Arc.app/Contents/MacOS/Arc";
    } else if (lower.includes("chromium")) {
      appName = "Chromium.app/Contents/MacOS/Chromium";
      extra = ["/opt/homebrew/bin/chromium", "/usr/local/bin/chromium"];
    }
    return [...roots.map((r) => path.join(r, appName)), ...extra];
  }

  private static getWindowsCandidates(
    lower: string,
    env: Record<string, string | undefined>,
  ): string[] {
    const winPath = path.win32;
    const localAppData = env.LOCALAPPDATA || "C:\\Users\\Default\\AppData\\Local";
    const programFiles = env.PROGRAMFILES || "C:\\Program Files";
    const programFilesX86 = env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)";

    let subPath = winPath.join("Google", "Chrome", "Application", "chrome.exe");
    if (lower.includes("brave")) {
      subPath = winPath.join("BraveSoftware", "Brave-Browser", "Application", "brave.exe");
    } else if (lower.includes("edge")) {
      subPath = winPath.join("Microsoft", "Edge", "Application", "msedge.exe");
    }
    return [
      winPath.join(localAppData, subPath),
      winPath.join(programFiles, subPath),
      winPath.join(programFilesX86, subPath),
    ];
  }
}
