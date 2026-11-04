import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { HostEnv } from "../core/env/host-env.js";
import { DaemonClient } from "../adapters/daemon/daemon-client.js";
import { BridgeDaemonService } from "../adapters/daemon/bridge-daemon.service.js";
import { createContainer } from "../container.js";
import { loadResolution } from "./config-context.js";
import { clearDaemonStatus, readDaemonStatus, writeDaemonStatus } from "./daemon-status.js";

export interface DaemonCliOptions {
  readonly socketPath?: string;
  readonly pidPath?: string;
  readonly timeoutMs?: number;
}

function tryAcquireSpawnLock(spawnLockPath: string): number | null {
  try {
    return fs.openSync(spawnLockPath, "wx");
  } catch (err: any) {
    if (err?.code === "EEXIST") {
      try {
        const raw = fs.readFileSync(spawnLockPath, "utf8");
        const parsed = JSON.parse(raw);
        const age = Date.now() - (parsed.createdAt || 0);
        let pidAlive = true;
        if (parsed.pid) {
          try {
            process.kill(parsed.pid, 0);
          } catch {
            pidAlive = false;
          }
        }
        if (!pidAlive || age > 15000) {
          try { fs.unlinkSync(spawnLockPath); } catch {}
          return fs.openSync(spawnLockPath, "wx");
        }
      } catch {
        try { fs.unlinkSync(spawnLockPath); } catch {}
        try { return fs.openSync(spawnLockPath, "wx"); } catch {}
      }
    }
    return null;
  }
}

/**
 * Automatically ensures the background daemon is running, spawning it detached
 * if needed with atomic spawn-lock arbitration to prevent bootstrap races.
 */
export async function ensureDaemonRunning(options: DaemonCliOptions = {}): Promise<boolean> {
  const socketPath = options.socketPath ?? HostEnv.getSocketPath();
  const client = new DaemonClient({ socketPath });
  try {
    if (await client.isAlive()) return true;

    const dir = path.dirname(socketPath);
    if (!fs.existsSync(dir)) {
      try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch {}
    }
    const spawnLockPath = `${socketPath}.spawning`;

    const maxAttempts = Math.min(30, Math.ceil((options.timeoutMs ?? 3000) / 100));
    let fd = tryAcquireSpawnLock(spawnLockPath);
    if (fd === null) {
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (await client.isAlive()) return true;
        if (!fs.existsSync(spawnLockPath)) {
          if (await client.isAlive()) return true;
          fd = tryAcquireSpawnLock(spawnLockPath);
          if (fd !== null) break;
        }
      }
      if (await client.isAlive()) return true;
      if (fd === null) return false;
    }

    try {
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));
      fs.closeSync(fd);
    } catch {}

    const script = process.argv[1] ?? "";
    if (!script || /\.test\.[tj]sx?$/.test(script) || script.includes("/bun:test")) {
      try { fs.unlinkSync(spawnLockPath); } catch {}
      return false;
    }

    let cliScript = script;
    if (/mcp\.(js|ts)$/.test(script)) {
      const candidate = script.replace(/mcp\.(js|ts)$/, "cli.$1");
      if (fs.existsSync(candidate)) {
        cliScript = candidate;
      } else {
        const distCandidate = path.join(path.dirname(script), "cli.js");
        if (fs.existsSync(distCandidate)) cliScript = distCandidate;
      }
    }

    const logPath = path.join(dir, "daemon.log");
    try {
      const out = fs.openSync(logPath, "a");
      const child = spawn(process.execPath, [cliScript, "daemon", "start", "--foreground"], {
        detached: true,
        stdio: ["ignore", out, out],
        env: { ...process.env },
      });
      child.unref();

      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (await client.isAlive()) return true;
      }
    } catch {
      return false;
    } finally {
      try { fs.unlinkSync(spawnLockPath); } catch {}
    }

    return false;
  } finally {
    client.disconnect();
  }
}

export async function handleDaemon(args: string[], options: DaemonCliOptions = {}): Promise<number> {
  const sub = args[0] || "status";
  const socketPath = options.socketPath ?? HostEnv.getSocketPath();
  const pidPath = options.pidPath ?? HostEnv.getDaemonPidPath();
  const client = new DaemonClient({ socketPath });

  switch (sub) {
    case "status": {
      const alive = await client.isAlive();
      if (!alive) {
        console.log("🛑 ConvoLink Daemon: OFFLINE");
        console.log(`   Socket: ${socketPath}`);
        return 0;
      }
      let pidInfo = "Unknown PID";
      if (fs.existsSync(pidPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(pidPath, "utf8"));
          pidInfo = `PID ${data.pid} (started: ${data.startedAt})`;
        } catch {}
      }
      const status = readDaemonStatus(socketPath);
      console.log(`🟢 ConvoLink Daemon: ONLINE [${pidInfo}]`);
      console.log(`   Socket: ${socketPath}`);
      if (status) {
        console.log(`   Transport: ${status.transport} (${status.endpoint})`);
        console.log(`   Browser: ${status.browserId}`);
      }
      return 0;
    }
    case "start": {
      const isAlive = await client.isAlive();
      if (isAlive) {
        console.log("⚠️ ConvoLink daemon is already running.");
        return 0;
      }
      const isForeground = args.includes("--foreground") || args.includes("-f");
      if (isForeground) {
        const resolution = await loadResolution();
        const container = createContainer(resolution.ok ? { resolution: resolution.value } : {});
        const transport = resolution.ok ? resolution.value.transport : container.browser.id;
        const endpoint = resolution.ok ? resolution.value.endpoint : "default";
        writeDaemonStatus({ transport, endpoint, browserId: resolution.ok ? resolution.value.browserId : "unconfigured", startedAt: new Date().toISOString() }, socketPath);
        const daemon = new BridgeDaemonService({ orchestrator: container.orchestrator, socketPath, pidPath });
        await daemon.start();
        console.log(`🚀 ConvoLink Daemon started in foreground on ${socketPath}`);
        console.log(`   Transport: ${transport} (${endpoint})`);
        const cleanup = async () => {
          await daemon.stop();
          await container.shutdown();
          clearDaemonStatus(socketPath);
          process.exit(0);
        };
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);
        await new Promise(() => {}); // Keep alive
        return 0;
      }
      const started = await ensureDaemonRunning(options);
      if (started) {
        console.log(`✅ ConvoLink Daemon started in background.`);
        console.log(`   Socket: ${socketPath}`);
        return 0;
      }
      console.error("❌ Failed to verify daemon startup within timeout.");
      return 1;
    }
    case "stop": {
      const isAlive = await client.isAlive();
      if (!isAlive) {
        if (fs.existsSync(socketPath)) try { fs.unlinkSync(socketPath); } catch {}
        if (fs.existsSync(pidPath)) try { fs.unlinkSync(pidPath); } catch {}
        console.log("🛑 ConvoLink Daemon is already stopped.");
        return 0;
      }
      try {
        await client.sendRequest("stop", undefined, 2000);
      } catch {}
      if (fs.existsSync(pidPath)) {
        try {
          const data = JSON.parse(fs.readFileSync(pidPath, "utf8"));
          if (data.pid && data.pid !== process.pid) process.kill(data.pid, "SIGTERM");
        } catch {}
      }
      console.log("🛑 ConvoLink Daemon stopped.");
      return 0;
    }
    case "restart": {
      await handleDaemon(["stop"], options);
      await new Promise((r) => setTimeout(r, 500));
      return handleDaemon(["start"], options);
    }
    default:
      console.error(`Unknown daemon command: ${sub}. Use: status, start, stop, restart`);
      return 1;
  }
}
