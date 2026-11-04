import type { Server, ServerWebSocket } from "bun";
import { ConvoError, type ConvoErrorCode } from "../../core/errors/convo-error.js";
import { ClientRegistry, type ClientHealth } from "./extension-bridge.routing.js";
import { isLoopbackAddress, isValidExtensionOrigin, validateHandshakeToken } from "./extension-bridge.security.js";
import type { BridgeTokenService } from "../../core/services/bridge-token.service.js";

export interface PendingRequest {
  readonly ws: ServerWebSocket<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_CLIENT_TTL_MS = 45_000;
export const DEFAULT_SWEEP_INTERVAL_MS = 15_000;

const CONVO_CODES = new Set<string>([
  "configuration-required", "configuration-invalid", "no-browser-found", "selection-unavailable",
  "browser-unreachable", "profile-locked", "default-profile-blocked", "transport-mismatch",
  "transport-timeout", "transport-disconnected", "extension-unsupported", "session-busy",
  "thread-not-found", "not-ready", "submission-failed", "not-owned", "internal",
]);

function asConvoCode(code: string | undefined): ConvoErrorCode {
  return code && CONVO_CODES.has(code) ? (code as ConvoErrorCode) : "internal";
}

export interface ExtensionBridgeOptions {
  readonly requestTimeoutMs?: number;
  readonly clientTtlMs?: number;
  readonly sweepIntervalMs?: number;
}

export interface BridgeServerOptions {
  readonly port: number;
  readonly tokenService?: BridgeTokenService;
  readonly requestTimeoutMs?: number;
  readonly clientTtlMs?: number;
  readonly sweepIntervalMs?: number;
  readonly onListTabsRequested?: () => Promise<void>;
}

export class ExtensionBridgeServer {
  public readonly port: number;
  public readonly registry = new ClientRegistry();
  private readonly tokenService?: BridgeTokenService;
  private readonly requestTimeoutMs: number;
  private readonly clientTtlMs: number;
  private readonly sweepIntervalMs: number;
  private readonly onListTabsRequested?: () => Promise<void>;

  private server: Server<unknown> | null = null;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private messageCounter = 0;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(options: BridgeServerOptions) {
    this.port = options.port;
    this.tokenService = options.tokenService;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.clientTtlMs = options.clientTtlMs ?? DEFAULT_CLIENT_TTL_MS;
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    this.onListTabsRequested = options.onListTabsRequested;
  }

  public isListening(): boolean {
    return this.server !== null;
  }

  public getConnectedClients(): ClientHealth[] {
    return this.registry.health();
  }

  public async start(): Promise<void> {
    if (this.server) return;
    const serverInstance = this;
    try {
      this.server = Bun.serve({
        port: this.port,
        hostname: "127.0.0.1",
        async fetch(req, srv) {
          const pathname = new URL(req.url).pathname;
          if (req.method === "GET" && pathname === "/status") {
            try { await serverInstance.onListTabsRequested?.(); } catch {}
            return Response.json({ protocolVersion: 2, clients: serverInstance.registry.health() });
          }
          if (!isValidExtensionOrigin(req.headers.get("origin"))) return new Response("Forbidden: Origin", { status: 403 });
          if (!isLoopbackAddress(srv.requestIP(req)?.address)) return new Response("Forbidden: IP", { status: 403 });
          if (srv.upgrade(req, { data: undefined })) return undefined;
          return new Response("ConvoLink Extension Bridge", { status: 200 });
        },
        websocket: {
          open: () => {},
          message: (ws, msg) => { serverInstance.handleIncomingMessage(ws, msg.toString()); },
          close: (ws) => { serverInstance.handleDisconnect(ws); },
        },
      });
    } catch (err: any) {
      if (err?.code === "EADDRINUSE") {
        const isHealthy = await fetch(`http://127.0.0.1:${this.port}/status`, {
          signal: AbortSignal.timeout(500),
        }).then((res) => res.ok).catch(() => false);
        if (isHealthy) return;
      }
      throw err;
    }
    this.sweeper ??= setInterval(() => this.evictStaleClients(), this.sweepIntervalMs);
  }

  public async stop(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }
    this.rejectAll(new Error("Adapter stopped"));
    for (const client of this.registry.getAll()) {
      try { client.ws.close(); } catch {}
    }
  }

  public sendRequestToClient<T>(ws: ServerWebSocket<unknown>, type: string, payload: Record<string, unknown>): Promise<T> {
    const id = ++this.messageCounter;
    this.trace(
      `→ ${type} id=${id} target=${String(payload.targetId ?? "-")} platform=${String(payload.platform ?? "-")} ` +
        `payload=${JSON.stringify(payload).slice(0, 220)}`,
    );
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        this.trace(`✗ timeout ${type} id=${id} after ${this.requestTimeoutMs}ms`);
        reject(new ConvoError("transport-timeout", `Extension request ${type} timed out.`, "Reload the extension and retry.", { retryable: true }));
      }, this.requestTimeoutMs);
      this.pendingRequests.set(id, { ws, resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        ws.send(JSON.stringify({ v: 2, id, type, ...payload }));
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(error as Error);
      }
    });
  }

  public rejectAll(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }

  private trace(message: string): void {
    if (process.env.CONVOLINK_DEBUG === "1") process.stderr.write(`[ext-bridge] ${message}\n`);
  }

  private handleIncomingMessage(ws: ServerWebSocket<unknown>, raw: string): void {
    try {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "HANDSHAKE") return this.handleHandshake(ws, message);
      if (message.type === "HEARTBEAT") {
        this.registry.touch(ws);
        ws.send(JSON.stringify({ type: "HEARTBEAT_ACK", timestamp: Date.now() }));
        return;
      }
      if (message.event === "TAB_REMOVED") {
        const targetId = String(message.targetId ?? "");
        for (const client of this.registry.getAll()) {
          client.tabs = client.tabs.filter((tab) => tab.targetId !== targetId && !tab.targetId.endsWith(`::${targetId}`));
        }
        return;
      }
      if (typeof message.id === "number" && this.pendingRequests.has(message.id)) {
        const pending = this.pendingRequests.get(message.id)!;
        this.pendingRequests.delete(message.id);
        clearTimeout(pending.timer);
        this.trace(
          `${message.ok === true ? "✓" : "✗"} id=${message.id} ` +
            (message.ok === true
              ? `result=${JSON.stringify(message.result)?.slice(0, 240)}`
              : JSON.stringify(message.error)),
        );
        if (message.ok === true) pending.resolve(message.result);
        else {
          const error = message.error as { code?: string; message?: string } | undefined;
          pending.reject(new ConvoError(asConvoCode(error?.code), error?.message ?? "Extension error", "Retry the command.", { retryable: true }));
        }
      }
    } catch {}
  }

  private handleDisconnect(ws: ServerWebSocket<unknown>): void {
    this.registry.removeBySocket(ws);
    for (const [id, pending] of this.pendingRequests.entries()) {
      if (pending.ws !== ws) continue;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
      pending.reject(new ConvoError("transport-disconnected", "The extension disconnected mid-request.", "Reconnect the extension and retry.", { retryable: true }));
    }
  }

  private handleHandshake(ws: ServerWebSocket<unknown>, message: Record<string, unknown>): void {
    if (message.protocolVersion !== 2) {
      ws.send(JSON.stringify({ type: "HANDSHAKE_ACK", success: false, protocolVersion: 2, error: "protocol-mismatch" }));
      ws.close(4001, "protocol-mismatch");
      return;
    }
    const auth = validateHandshakeToken(message.token as string | undefined, this.tokenService);
    if (!auth.valid) {
      ws.send(JSON.stringify({ type: "HANDSHAKE_ACK", success: false, protocolVersion: 2, error: auth.error }));
      ws.close(4001, auth.error ?? "unauthorized");
      return;
    }
    const client = this.registry.register(ws, message as never);
    ws.send(JSON.stringify({ type: "HANDSHAKE_ACK", success: true, serverGeneration: client.serverGeneration, protocolVersion: 2 }));
  }

  private evictStaleClients(): void {
    for (const client of this.registry.evictStale(this.clientTtlMs)) {
      try { client.ws.close(4002, "heartbeat-timeout"); } catch {}
      this.handleDisconnect(client.ws);
    }
  }
}
