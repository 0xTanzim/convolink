import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import { HostEnv } from "../../core/env/host-env.js";
import type { SessionOrchestrator } from "../../core/services/orchestrator.js";
import type { IpcCommand, IpcRequest } from "./daemon-ipc.types.js";
import { ExtensionBridgeAdapter } from "../browsers/extension-bridge.adapter.js";
import { BridgeTokenService } from "../../core/services/bridge-token.service.js";

export interface BridgeDaemonOptions {
  readonly orchestrator: SessionOrchestrator;
  readonly socketPath?: string;
  readonly pidPath?: string;
  readonly extensionPort?: number;
}

export class BridgeDaemonService {
  private readonly orchestrator: SessionOrchestrator;
  private readonly socketPath: string;
  private readonly pidPath: string;
  private readonly extensionPort?: number;
  private extAdapter: ExtensionBridgeAdapter | null = null;
  private server: net.Server | null = null;
  private readonly activeSockets = new Set<net.Socket>();
  private isStopping = false;

  constructor(options: BridgeDaemonOptions) {
    this.orchestrator = options.orchestrator;
    this.socketPath = options.socketPath ?? HostEnv.getSocketPath();
    this.pidPath = options.pidPath ?? HostEnv.getDaemonPidPath();
    this.extensionPort = options.extensionPort !== undefined ? options.extensionPort : 9224;
  }

  public async start(): Promise<void> {
    const dir = path.dirname(this.socketPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

    await this.cleanupStaleSocket();
    // When the container already owns the extension transport, it owns port
    // 9224 too. Binding a second adapter here silently failed and left the
    // daemon talking to an adapter that was never listening.
    const containerTransport = this.orchestrator.getBrowser().id;
    if (containerTransport !== "extension-bridge" && this.extensionPort && this.extensionPort > 0) {
      try {
        this.extAdapter = new ExtensionBridgeAdapter(this.extensionPort, new BridgeTokenService());
        await this.extAdapter.start();
      } catch {}
    }

    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => this.handleClient(socket));
      this.server.on("error", (err) => reject(err));
      this.server.listen(this.socketPath, async () => {
        try {
          fs.writeFileSync(this.pidPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }), { mode: 0o600 });
        } catch {}
        try { await this.orchestrator.listTabs(); } catch {}
        resolve();
      });
    });
  }

  private handleClient(socket: net.Socket): void {
    this.activeSockets.add(socket);
    let buffer = "";

    socket.on("data", async (chunk) => {
      buffer += chunk.toString("utf8");
      let newlineIdx: number;
      while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, newlineIdx).trim();
        buffer = buffer.slice(newlineIdx + 1);
        if (!line) continue;
        await this.processRequest(socket, line);
      }
    });

    socket.on("close", () => this.activeSockets.delete(socket));
    socket.on("error", () => this.activeSockets.delete(socket));
  }

  private async processRequest(socket: net.Socket, line: string): Promise<void> {
    let req: IpcRequest;
    try {
      req = JSON.parse(line) as IpcRequest;
    } catch {
      socket.write(JSON.stringify({ id: "unknown", ok: false, error: "Malformed JSON" }) + "\n");
      return;
    }

    try {
      const result = await this.dispatch(req.command, req.payload);
      socket.write(JSON.stringify({ id: req.id, ok: true, result }) + "\n");
      if (req.command === "stop") {
        setTimeout(() => this.stop(), 50);
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      socket.write(JSON.stringify({ id: req.id, ok: false, error }) + "\n");
    }
  }

  private async dispatch(command: IpcCommand, payload?: Record<string, unknown>): Promise<unknown> {
    switch (command) {
      case "ping":
        return "pong";
      case "doctor":
        return this.orchestrator.doctor();
      case "list":
        return this.orchestrator.listTabs();
      case "ask": {
        const p = (payload ?? {}) as Record<string, any>;
        const toggles = (p.toggles || p.deepSearch !== undefined || p.deepThink !== undefined)
          ? { search: p.deepSearch ?? p.toggles?.search, think: p.deepThink ?? p.toggles?.think } : undefined;
        return this.orchestrator.ask({
          prompt: String(p.prompt ?? ""), platform: p.platform, targetId: p.targetId ? String(p.targetId) : undefined,
          timeoutMs: p.timeoutMs ? Number(p.timeoutMs) : undefined, toggles, files: Array.isArray(p.files) ? p.files : undefined,
          writeFiles: Boolean(p.writeFiles), outDir: p.outDir ? String(p.outDir) : undefined,
          autoContinue: p.autoContinue !== false, newChat: Boolean(p.newChat), openTab: Boolean(p.openTab),
        });
      }
      case "compare": {
        const p = (payload ?? {}) as Record<string, any>;
        return this.orchestrator.compare({
          prompt: String(p.prompt ?? ""), platforms: Array.isArray(p.platforms) ? p.platforms : undefined,
          arbitrate: Boolean(p.arbitrate), arbiter: p.arbiter, mode: p.mode, outDir: p.outDir,
          timeoutMs: p.timeoutMs ? Number(p.timeoutMs) : undefined,
        });
      }
      case "tab_new": {
        const p = (payload ?? {}) as Record<string, any>;
        return this.orchestrator.createTab(String(p.target ?? "chatgpt"));
      }
      case "tab_close": {
        const p = (payload ?? {}) as Record<string, any>;
        return this.orchestrator.closeTab(String(p.targetId));
      }
      case "eval": {
        const p = (payload ?? {}) as Record<string, any>;
        const handle = await this.orchestrator.getBrowser().attach(String(p.targetId));
        try {
          return await this.orchestrator.getBrowser().evaluate(handle, String(p.expression));
        } finally {
          await this.orchestrator.getBrowser().detach(handle);
        }
      }
      case "stop":
        return { stopped: true };
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  }

  private async cleanupStaleSocket(): Promise<void> {
    if (!fs.existsSync(this.socketPath)) return;
    if (fs.existsSync(this.pidPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(this.pidPath, "utf8"));
        if (data.pid && typeof data.pid === "number") {
          try {
            process.kill(data.pid, 0);
            throw new Error(`ConvoLink daemon is already running (PID: ${data.pid})`);
          } catch (e: any) {
            if (e.code !== "ESRCH") throw e;
          }
        }
      } catch (err: any) {
        if (err.message.includes("already running")) throw err;
      }
    }
    try { fs.unlinkSync(this.socketPath); } catch {}
    try { fs.unlinkSync(this.pidPath); } catch {}
  }

  public async stop(): Promise<void> {
    if (this.isStopping) return;
    this.isStopping = true;
    for (const socket of this.activeSockets) {
      try { socket.destroy(); } catch {}
    }
    this.activeSockets.clear();

    if (this.extAdapter) {
      try { await this.extAdapter.stop(); } catch {}
      this.extAdapter = null;
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }

    try { if (fs.existsSync(this.socketPath)) fs.unlinkSync(this.socketPath); } catch {}
    try { if (fs.existsSync(this.pidPath)) fs.unlinkSync(this.pidPath); } catch {}
  }
}
