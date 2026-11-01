import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { HostEnv } from "../../core/env/host-env.js";
import { PlatformEnv } from "../../core/env/platform-env.js";

export interface LauncherDependencies {
  findBinary?: (browserName?: string) => string | null;
  checkPort?: (port: number, host?: string) => Promise<boolean>;
  spawnProcess?: (bin: string, args: string[], opts: { detached: boolean; stdio: "ignore" }) => void;
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
      return res.ok;
    } catch {
      return false;
    }
  }

  public isProfileLocked(profilePath?: string): { locked: boolean; pid?: number } {
    if (!profilePath) return { locked: false };
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
    return { locked: false };
  }

  public async ensureBrowserRunning(options: EnsureBrowserOptions = {}): Promise<boolean> {
    const port = options.port ?? 9222;
    if (await this.checkPort(port)) {
      return true;
    }

    const binary = this.findBinary(options.browser);
    if (!binary) return false;

    const args = [`--remote-debugging-port=${port}`];
    if (options.profilePath) {
      args.push(`--user-data-dir=${options.profilePath}`);
    }
    if (options.profileDirectory) {
      args.push(`--profile-directory=${options.profileDirectory}`);
      args.push("--no-first-run");
    }
    if (options.headless === true || (options.headless === undefined && this.isHeadless())) {
      args.push("--headless=new", "--disable-gpu", "--disable-dev-shm-usage", "--no-sandbox");
    }

    this.spawner(binary, args, { detached: true, stdio: "ignore" });

    const timeout = options.timeoutMs ?? 3000;
    const interval = options.pollIntervalMs ?? 250;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      if (await this.checkPort(port)) {
        return true;
      }
    }

    const lock = this.isProfileLocked(options.profilePath);
    if (lock.locked) {
      console.error(
        `\n⚠️ Profile '${options.profilePath}' is currently open in another process (PID ${lock.pid}) without remote debugging enabled.`,
      );
      console.error(
        `💡 Chromium ignores --remote-debugging-port when attaching to an already-running browser instance.`,
      );
      console.error(
        `💡 To fix: Close that browser window and retry, or use a dedicated ConvoLink profile ('convo profile select 1').\n`,
      );
    }

    return false;
  }
}
