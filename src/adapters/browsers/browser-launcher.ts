import { spawn } from "node:child_process";
import * as fs from "node:fs";
import { inspectFirefoxProfile } from "./firefox-profile.js";
import { writeBrowserRecord } from "./browser-records.js";
import * as net from "node:net";
import * as path from "node:path";
import { HostEnv } from "../../core/env/host-env.js";
import { PlatformEnv } from "../../core/env/platform-env.js";

export interface LauncherDependencies {
  findBinary?: (browserName?: string) => string | null;
  checkPort?: (port: number, host?: string) => Promise<boolean>;
  spawnProcess?: (bin: string, args: string[], opts: { detached: boolean; stdio: "ignore" }) => { pid?: number } | void;
  isWsl?: () => boolean;
  getWslGateway?: () => string | null;
  isHeadless?: () => boolean;
}

export interface EnsureBrowserOptions {
  port?: number;
  profilePath?: string;
  profileDirectory?: string;
  browser?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  headless?: boolean;
}

export class BrowserLauncherService {
  private readonly findBinary: (browserName?: string) => string | null;
  private readonly customPortChecker?: (port: number, host?: string) => Promise<boolean>;
  private readonly spawner: (bin: string, args: string[], opts: { detached: boolean; stdio: "ignore" }) => void;
  private readonly isWsl: () => boolean;
  private readonly getWslGateway: () => string | null;
  private readonly isHeadless: () => boolean;

  public constructor(deps: LauncherDependencies = {}) {
    this.findBinary = deps.findBinary ?? ((b) => HostEnv.findBrowserExecutable(b));
    this.customPortChecker = deps.checkPort;
    this.isWsl = deps.isWsl ?? (() => PlatformEnv.isWsl());
    this.getWslGateway = deps.getWslGateway ?? (() => PlatformEnv.getWslGatewayIp());
    this.isHeadless = deps.isHeadless ?? (() => PlatformEnv.isHeadless());
    this.spawner =
      deps.spawnProcess ??
      ((bin, args, opts) => {
        const child = spawn(bin, args, opts);
        child.unref();
      });
  }

  public async checkPort(port = 9222, host = "127.0.0.1"): Promise<boolean> {
    if (this.customPortChecker) {
      if (await this.customPortChecker(port, host)) return true;
      if (host === "127.0.0.1" && this.isWsl()) {
        const gw = this.getWslGateway();
        if (gw && (await this.customPortChecker(port, gw))) return true;
      }
      return false;
    }

    if (await this.ping(host, port)) return true;
    if (host === "127.0.0.1" && this.isWsl()) {
      const gw = this.getWslGateway();
      if (gw && (await this.ping(gw, port))) return true;
    }
    return false;
  }

  private async ping(host: string, port: number): Promise<boolean> {
    try {
      const res = await fetch(`http://${host}:${port}/json/version`, {
        signal: AbortSignal.timeout(300),
      });
      if (res.ok) return true;
    } catch {}

    return new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host, port });
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

  public isProfileLocked(profilePath?: string): { locked: boolean; pid?: number } {
    if (!profilePath) return { locked: false };
    // Check Chromium SingletonLock
    const lockFile = path.join(profilePath, "SingletonLock");
    try {
      const target = fs.readlinkSync(lockFile);
      const parts = target.split("-");
      const pidStr = parts[parts.length - 1];
      const pid = pidStr ? parseInt(pidStr, 10) : undefined;
      if (pid && !isNaN(pid)) {
        try {
          process.kill(pid, 0);
          return { locked: true, pid };
        } catch {
          return { locked: false };
        }
      }
    } catch {}

    // Check Gecko (Firefox / Zen) lock symlink (lock -> ip:+<pid>)
    const geckoLock = path.join(profilePath, "lock");
    try {
      const target = fs.readlinkSync(geckoLock);
      const parts = target.split(":+");
      const pidStr = parts[parts.length - 1];
      const pid = pidStr ? parseInt(pidStr, 10) : undefined;
      if (pid && !isNaN(pid)) {
        try {
          process.kill(pid, 0);
          return { locked: true, pid };
        } catch {
          return { locked: false };
        }
      }
    } catch {}

    return { locked: false };
  }

  public async ensureBrowserRunning(options: EnsureBrowserOptions = {}): Promise<boolean> {
    const binary = this.findBinary(options.browser);
    if (!binary) return false;

    const isGecko = Boolean(
      (options.browser && (options.browser.toLowerCase().includes("firefox") || options.browser.toLowerCase().includes("zen"))) ||
      binary.toLowerCase().includes("firefox") ||
      binary.toLowerCase().includes("zen"),
    );

    const port = options.port ?? (isGecko ? 9223 : 9222);
    if (await this.checkPort(port)) return true;

    if (isGecko && options.profilePath) {
      const lock = inspectFirefoxProfile(options.profilePath);
      // A profile is owned by one process. Spawning a second instance exits
      // immediately and leaves no debug port, which is the ghost we must avoid.
      if (lock.locked && !lock.debugging) return false;
    }

    if (isGecko && options.profilePath && !this.isProfileLocked(options.profilePath).locked) {
      try { fs.unlinkSync(path.join(options.profilePath, "lock")); } catch {}
      try { fs.unlinkSync(path.join(options.profilePath, ".parentlock")); } catch {}
    }

    const args = [`--remote-debugging-port=${port}`];
    if (isGecko) {
      args.push("-no-remote", "--remote-allow-origins=*");
      if (options.profilePath) args.push("-profile", options.profilePath);
      if (options.headless === true || (options.headless === undefined && this.isHeadless())) args.push("-headless");
    } else {
      if (options.profilePath) args.push(`--user-data-dir=${options.profilePath}`);
      if (options.profileDirectory) {
        const targetDir = options.profilePath ? path.join(options.profilePath, options.profileDirectory) : "";
        const defaultDir = options.profilePath ? path.join(options.profilePath, "Default") : "";
        const profDir = !fs.existsSync(targetDir) && fs.existsSync(defaultDir) ? "Default" : options.profileDirectory;
        args.push(`--profile-directory=${profDir}`, "--no-first-run");
      }
      if (options.headless === true || (options.headless === undefined && this.isHeadless())) {
        args.push("--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox");
      }
    }

    this.spawner(binary, args, { detached: true, stdio: "ignore" });

    const timeout = options.timeoutMs ?? 3000;
    const interval = options.pollIntervalMs ?? 250;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      if (await this.checkPort(port)) return true;
    }

    const lock = this.isProfileLocked(options.profilePath);
    if (lock.locked) {
      console.error(
        `\n⚠️ Profile '${options.profilePath}' is currently open in another process (PID ${lock.pid}) without remote debugging enabled.`,
      );
      if (isGecko) {
        const binName = options.browser?.toLowerCase().includes("zen") ? "zen" : "firefox";
        console.error(`💡 Firefox/Zen ignores --remote-debugging-port when joining an already-running browser instance.`);
        console.error(`💡 Solutions:`);
        console.error(`   1. Launch with debugging: '${binName} -no-remote --remote-debugging-port=${port}'`);
        console.error(`   2. Or connect without flags via Companion Extension: 'convo ext pair'`);
        console.error(`   3. Or select another profile with 'convo profile list'.\n`);
      } else {
        console.error(`💡 Chromium ignores --remote-debugging-port when attaching to an already-running browser instance.`);
        console.error(`💡 To fix: Close that browser window and retry, or select another profile with 'convo profile list'.\n`);
      }
    }

    return false;
  }
}
