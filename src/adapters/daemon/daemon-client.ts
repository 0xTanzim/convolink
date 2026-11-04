import * as net from "node:net";
import * as fs from "node:fs";
import { HostEnv } from "../../core/env/host-env.js";
import type { IpcCommand, IpcRequest, IpcResponse } from "./daemon-ipc.types.js";

export interface DaemonClientOptions {
  readonly socketPath?: string;
}

interface PendingItem {
  readonly resolve: (val: any) => void;
  readonly reject: (err: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class DaemonClient {
  private readonly socketPath: string;
  private socket: net.Socket | null = null;
  private buffer = "";
  private readonly pending = new Map<string, PendingItem>();
  private connectingPromise: Promise<net.Socket> | null = null;

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

  public disconnect(): void {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.buffer = "";
    this.rejectAllPending("Client disconnected");
  }

  private rejectAllPending(reason: string): void {
    for (const [, item] of this.pending.entries()) {
      clearTimeout(item.timer);
      item.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private async ensureSocket(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed && this.socket.readyState === "open") {
      return this.socket;
    }
    if (this.connectingPromise) return this.connectingPromise;

    this.connectingPromise = new Promise<net.Socket>((resolve, reject) => {
      const s = net.createConnection({ path: this.socketPath });
      s.on("connect", () => {
        this.socket = s;
        this.connectingPromise = null;
        resolve(s);
      });
      s.on("data", (chunk) => this.handleData(chunk));
      s.on("error", (err) => {
        this.connectingPromise = null;
        if (this.socket === s) this.socket = null;
        this.rejectAllPending(err.message);
        reject(err);
      });
      s.on("close", () => {
        this.connectingPromise = null;
        if (this.socket === s) this.socket = null;
        this.rejectAllPending("Connection closed by daemon");
      });
    });

    return this.connectingPromise;
  }

  private handleData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);
      if (!line) continue;
      try {
        const parsed = JSON.parse(line) as IpcResponse;
        const item = this.pending.get(parsed.id);
        if (item) {
          this.pending.delete(parsed.id);
          clearTimeout(item.timer);
          item.resolve(parsed);
        }
      } catch {}
    }
  }

  public async sendRequest<T = unknown>(
    command: IpcCommand,
    payload?: Record<string, unknown>,
    timeoutMs: number = 300000,
  ): Promise<IpcResponse & { result?: T }> {
    const socket = await this.ensureSocket();
    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const request: IpcRequest = { id, command, payload };

    return new Promise<IpcResponse & { result?: T }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`IPC request '${command}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      try {
        socket.write(JSON.stringify(request) + "\n");
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err as Error);
      }
    });
  }
}
