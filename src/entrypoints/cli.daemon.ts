import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { HostEnv } from "../core/env/host-env.js";
import { DaemonClient } from "../adapters/daemon/daemon-client.js";
import { BridgeDaemonService } from "../adapters/daemon/bridge-daemon.service.js";
import { createContainer } from "../container.js";

export interface DaemonCliOptions {
  readonly socketPath?: string;
  readonly pidPath?: string;
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
      console.log(`🟢 ConvoLink Daemon: ONLINE [${pidInfo}]`);
      console.log(`   Socket: ${socketPath}`);
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
        const container = createContainer();
        const daemon = new BridgeDaemonService({ orchestrator: container.orchestrator, socketPath, pidPath });
        await daemon.start();
        console.log(`🚀 ConvoLink Daemon started in foreground on ${socketPath}`);
        const cleanup = async () => {
          await daemon.stop();
          process.exit(0);
        };
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);
        await new Promise(() => {}); // Keep alive
        return 0;
      }
      const script = process.argv[1] ?? "";
      const logPath = path.join(path.dirname(socketPath), "daemon.log");
      const out = fs.openSync(logPath, "a");
      const child = spawn(process.execPath, [script, "daemon", "start", "--foreground"], {
        detached: true,
        stdio: ["ignore", out, out],
        env: { ...process.env },
      });
      child.unref();
      // Wait up to 3s for daemon to become alive
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (await client.isAlive()) {
          console.log(`✅ ConvoLink Daemon started in background (PID ${child.pid}).`);
          console.log(`   Socket: ${socketPath}`);
          return 0;
        }
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
