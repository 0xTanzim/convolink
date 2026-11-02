import * as fs from "node:fs";
import * as path from "node:path";
import { HostEnv } from "../core/env/host-env.js";

export interface DaemonStatus {
  readonly transport: string;
  readonly endpoint: string;
  readonly browserId: string;
  readonly startedAt: string;
}

export function daemonStatusPath(socketPath = HostEnv.getSocketPath()): string {
  return path.join(path.dirname(socketPath), "daemon-status.json");
}

export function writeDaemonStatus(status: DaemonStatus, socketPath?: string): void {
  const file = daemonStatusPath(socketPath);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify(status, null, 2), { mode: 0o600 });
}

export function readDaemonStatus(socketPath?: string): DaemonStatus | null {
  try {
    return JSON.parse(fs.readFileSync(daemonStatusPath(socketPath), "utf8")) as DaemonStatus;
  } catch {
    return null;
  }
}

export function clearDaemonStatus(socketPath?: string): void {
  try {
    fs.rmSync(daemonStatusPath(socketPath), { force: true });
  } catch {}
}
