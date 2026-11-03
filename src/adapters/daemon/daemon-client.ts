import * as net from "node:net";
import * as fs from "node:fs";
import { HostEnv } from "../../core/env/host-env.js";
import type { IpcCommand, IpcRequest, IpcResponse } from "./daemon-ipc.types.js";

export interface DaemonClientOptions {
  readonly socketPath?: string;
}

export class DaemonClient {
  private readonly socketPath: string;

  constructor(options: DaemonClientOptions = {}) {
    this.socketPath = options.socketPath ?? HostEnv.getSocketPath();
  }

  public async isAlive(timeoutMs: number = 800): Promise<boolean> {
    if (!fs.existsSync(this.socketPath)) return false;
    try {
      const res = await this.sendRequest("ping", undefined, timeoutMs);
      return res.ok;
    } catch {
      return false;
    }
  }

  public sendRequest<T = unknown>(
    command: IpcCommand,
    payload?: Record<string, unknown>,
    timeoutMs: number = 300000
  ): Promise<IpcResponse & { result?: T }> {
    return new Promise((resolve, reject) => {
      const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const request: IpcRequest = { id, command, payload };
      const socket = net.createConnection({ path: this.socketPath });
      let buffer = "";
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          socket.destroy();
          reject(new Error(`IPC request '${command}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      socket.on("connect", () => {
        socket.write(JSON.stringify(request) + "\n");
      });

      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const newlineIdx = buffer.indexOf("\n");
        if (newlineIdx !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          settled = true;
          clearTimeout(timer);
          socket.end();
          try {
            const parsed = JSON.parse(line) as IpcResponse & { result?: T };
            resolve(parsed);
          } catch (err) {
            reject(new Error(`Invalid IPC response framing: ${(err as Error).message}`));
          }
        }
      });

      socket.on("end", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("IPC connection closed prematurely by daemon"));
        }
      });

      socket.on("close", (hadError) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error(`IPC connection closed (hadError=${hadError})`));
        }
      });

      socket.on("error", (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
    });
  }
}
