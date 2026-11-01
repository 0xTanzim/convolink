import type { Server, ServerWebSocket } from "bun";
import type {
  BrowserPort,
  BrowserCapabilities,
  SessionHandle,
  TabDescriptor,
  TransportHealth,
} from "../../core/ports/browser.port.js";
import { BrowserConnectionError } from "../../core/errors/bridge-errors.js";
import { ClientRegistry, mapClientTabs, type ConnectedClient } from "./extension-bridge.routing.js";
import {
  isLoopbackAddress,
  isValidExtensionOrigin,
  validateHandshakeToken,
} from "./extension-bridge.security.js";
import type { BridgeTokenService } from "../../core/services/bridge-token.service.js";

interface PendingRequest {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
}

export class ExtensionBridgeAdapter implements BrowserPort {
  public readonly id = "extension-bridge" as const;
  public readonly capabilities: BrowserCapabilities = {
    protocol: "cdp", browserFamily: "chromium",
    supportsBackgroundLifecycle: true, supportsFileDownloads: false, supportsTabManagement: true,
  };

  private readonly port: number;
  private readonly tokenService?: BridgeTokenService;
  private server: Server<unknown> | null = null;
  private readonly registry = new ClientRegistry();
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private messageCounter = 0;

  constructor(port = 9224, tokenService?: BridgeTokenService) {
    this.port = port;
    this.tokenService = tokenService;
  }

  public getConnectedClients(): ConnectedClient[] { return this.registry.getAll(); }

  public async start(): Promise<void> {
    if (this.server) return;
    const adapter = this;
    this.server = Bun.serve({
      port: this.port, hostname: "127.0.0.1",
      fetch(req, server) {
        if (!isValidExtensionOrigin(req.headers.get("origin"))) return new Response("Forbidden: Origin", { status: 403 });
        if (!isLoopbackAddress(server.requestIP(req)?.address)) return new Response("Forbidden: IP", { status: 403 });
        if (server.upgrade(req, { data: undefined })) return undefined;
        return new Response("ConvoLink Extension Bridge", { status: 200 });
      },
      websocket: {
        open: () => {},
        message: (ws, msg) => { adapter.handleIncomingMessage(ws, msg.toString()); },
        close: (ws) => { adapter.registry.removeBySocket(ws); },
      },
    });
  }

  public async stop(): Promise<void> {
    if (this.server) { this.server.stop(true); this.server = null; }
    for (const req of this.pendingRequests.values()) req.reject(new Error("Adapter stopped"));
    this.pendingRequests.clear();
  }

  public async health(): Promise<TransportHealth> {
    const start = Date.now();
    await this.start();
    const clients = this.registry.getAll();
    const endpoint = `ws://127.0.0.1:${this.port}`;
    if (clients.length === 0) {
      return { ok: false, adapterId: this.id, endpoint, openTabsCount: 0, latencyMs: Date.now() - start, capabilities: this.capabilities, error: `No ConvoLink Companion extension connected on ${endpoint}` };
    }
    try {
      const tabs = await this.listTabs();
      const labels = clients.map((c) => `${c.browserFamily} [${c.profileLabel}]`).join(", ");
      return { ok: true, adapterId: this.id, endpoint: `${endpoint} (${labels})`, openTabsCount: tabs.length, latencyMs: Date.now() - start, capabilities: this.capabilities };
    } catch (err: unknown) {
      return { ok: false, adapterId: this.id, endpoint, openTabsCount: 0, latencyMs: Date.now() - start, error: (err as Error).message, capabilities: this.capabilities };
    }
  }

  public async listTabs(): Promise<TabDescriptor[]> {
    const clients = this.registry.getAll();
    const aggregated: TabDescriptor[] = [];
    for (const client of clients) {
      try {
        const res = await this.sendRequestToClient<any>(client.ws, "LIST_TABS", {});
        const mapped = mapClientTabs(Array.isArray(res) ? res : res?.tabs || [], client, clients.length > 1);
        client.tabs = mapped;
        aggregated.push(...mapped);
      } catch {}
    }
    return aggregated;
  }

  public attach(targetId: string): Promise<SessionHandle> {
    return this.sendAction("ATTACH", targetId).then(() => ({ sessionId: `ext-${targetId}-${Date.now()}`, targetId, adapterId: this.id }));
  }
  public detach(handle: SessionHandle): Promise<void> { return this.sendAction("DETACH", handle.targetId).catch(() => {}); }
  public keepAliveInBackground(_handle: SessionHandle): Promise<void> { return Promise.resolve(); }
  public bringToFront(h: SessionHandle): Promise<void> { return this.sendAction("BRING_TO_FRONT", h.targetId); }

  public async evaluate<T>(h: SessionHandle, expression: string): Promise<T> {
    const res = await this.sendRequest<any>("EVALUATE", { targetId: h.targetId, expression }, h.targetId);
    return res && typeof res === "object" && "value" in res ? res.value : res;
  }

  public fillText(h: SessionHandle, selector: string, text: string): Promise<void> { return this.sendAction("FILL_TEXT", h.targetId, { selector, text }); }
  public click(h: SessionHandle, selector: string): Promise<void> { return this.sendAction("CLICK", h.targetId, { selector }); }
  public pressKey(h: SessionHandle, selector: string, key: string): Promise<void> { return this.sendAction("PRESS_KEY", h.targetId, { selector, key }); }
  public setInputFiles(): Promise<void> { return Promise.resolve(); }
  public createTab(url: string): Promise<TabDescriptor> { return this.sendRequest("CREATE_TAB", { url }); }
  public closeTab(targetId: string): Promise<void> { return this.sendAction("CLOSE_TAB", targetId); }
  public navigate(h: SessionHandle, url: string): Promise<void> { return this.sendAction("NAVIGATE", h.targetId, { url }); }

  private sendAction(type: string, targetId: string, extra: Record<string, unknown> = {}): Promise<void> {
    return this.sendRequest(type, { targetId, ...extra }, targetId);
  }

  private async sendRequest<T>(type: string, payload: Record<string, unknown>, targetId?: string): Promise<T> {
    const route = targetId ? this.registry.findClientForTarget(targetId) : null;
    const client = route?.client ?? this.registry.getPrimary();
    if (!client) throw new BrowserConnectionError(`ws://127.0.0.1:${this.port}`, "Extension is not connected");
    return this.sendRequestToClient<T>(client.ws, type, route ? { ...payload, targetId: route.rawTabId } : payload);
  }

  private async sendRequestToClient<T>(ws: ServerWebSocket<unknown>, type: string, payload: Record<string, unknown>): Promise<T> {
    const id = ++this.messageCounter;
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (val: unknown) => void, reject });
      ws.send(JSON.stringify({ id, type, ...payload }));
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Extension bridge request ${type} timed out`));
        }
      }, 10000);
    });
  }

  private handleIncomingMessage(ws: ServerWebSocket<unknown>, raw: string): void {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "HANDSHAKE") {
        const auth = validateHandshakeToken(msg.token, this.tokenService);
        if (!auth.valid) {
          ws.send(JSON.stringify({ type: "HANDSHAKE_ACK", success: false, error: auth.error }));
          ws.close(4001, auth.error);
          return;
        }
        const client = this.registry.register(ws, msg);
        ws.send(JSON.stringify({ type: "HANDSHAKE_ACK", success: true, serverGeneration: client.serverGeneration }));
        return;
      }
      if (msg.id && this.pendingRequests.has(msg.id)) {
        const req = this.pendingRequests.get(msg.id)!;
        this.pendingRequests.delete(msg.id);
        if (msg.error) req.reject(new Error(msg.error));
        else req.resolve(msg.result);
      }
    } catch {}
  }
}
