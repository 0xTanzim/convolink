import { spawn } from "node:child_process";
import { HostEnv } from "../../core/env/host-env.js";

export interface LauncherDependencies {
  findBinary?: () => string | null;
  checkPort?: (port: number) => Promise<boolean>;
  spawnProcess?: (bin: string, args: string[], opts: { detached: boolean; stdio: "ignore" }) => void;
}

export interface EnsureBrowserOptions {
  port?: number;
  profilePath?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export class BrowserLauncherService {
  private readonly findBinary: () => string | null;
  private readonly portChecker: (port: number) => Promise<boolean>;
  private readonly spawner: (bin: string, args: string[], opts: { detached: boolean; stdio: "ignore" }) => void;

  public constructor(deps: LauncherDependencies = {}) {
    this.findBinary = deps.findBinary ?? (() => HostEnv.findChromeExecutable());
    this.portChecker = deps.checkPort ?? ((port) => this.checkPort(port));
    this.spawner =
      deps.spawnProcess ??
      ((bin, args, opts) => {
        const child = spawn(bin, args, opts);
        child.unref();
      });
  }

  public async checkPort(port = 9222): Promise<boolean> {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(300),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  public async ensureBrowserRunning(options: EnsureBrowserOptions = {}): Promise<boolean> {
    const port = options.port ?? 9222;
    if (await this.portChecker(port)) {
      return true;
    }

    const binary = this.findBinary();
    if (!binary) return false;

    const args = [`--remote-debugging-port=${port}`];
    if (options.profilePath) {
      args.push(`--user-data-dir=${options.profilePath}`);
    }

    this.spawner(binary, args, { detached: true, stdio: "ignore" });

    const timeout = options.timeoutMs ?? 3000;
    const interval = options.pollIntervalMs ?? 250;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval));
      if (await this.portChecker(port)) {
        return true;
      }
    }

    return false;
  }
}
