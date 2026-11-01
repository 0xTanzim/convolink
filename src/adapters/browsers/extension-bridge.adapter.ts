import type { Server, ServerWebSocket } from "bun";
import type {
  BrowserPort,
  BrowserCapabilities,
  SessionHandle,
  TabDescriptor,
  TransportHealth,
} from "../../core/ports/browser.port.js";
import { BrowserConnectionError } from "../../core/errors/bridge-errors.js";
import { ClientRegistry, type ConnectedClient } from "./extension-bridge.routing.js";

interface PendingRequest {
  resolve: (val: unknown) => void;
  reject: (err: Error) => void;
}

export class ExtensionBridgeAdapter implements BrowserPort {
  public readonly id = "extension-bridge" as const;
  public readonly capabilities: BrowserCapabilities = {
    protocol: "cdp",
    browserFamily: "chromium",
    supportsBackgroundLifecycle: true,
    supportsFileDownloads: false,
    supportsTabManagement: true,
  };

  private readonly port: number;
  private server: Server<unknown> | null = null;
  private readonly registry = new ClientRegistry();
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private messageCounter = 0;

  constructor(port = 9224) {
    this.port = port;
  }

  public getConnectedClients(): ConnectedClient[] {
    return this.registry.getAll();
  }

  public async start(): Promise<void> {
    if (this.server) return;
    const adapter = this;
    this.server = Bun.serve({
      port: this.port,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (server.upgrade(req, { data: undefined })) return undefined;
        return new Response("ConvoLink Extension Bridge", { status: 200 });
      },
      websocket: {
        open: () => {},
        message: (ws, message) => {
          adapter.handleIncomingMessage(ws, message.toString());
        },
        close: (ws) => {
          adapter.registry.removeBySocket(ws);
        },
      },
    });
  }

  public async stop(): Promise<void> {
    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }
    for (const req of this.pendingRequests.values()) {
      req.reject(new Error("ExtensionBridgeAdapter stopped"));
    }
    this.pendingRequests.clear();
  }

  public async health(): Promise<TransportHealth> {
    const start = Date.now();
    await this.start();
    const clients = this.registry.getAll();
    if (clients.length === 0) {
      return {
        ok: false, adapterId: this.id, endpoint: `ws://127.0.0.1:${this.port}`,
        openTabsCount: 0, latencyMs: Date.now() - start, capabilities: this.capabilities,
        error: `No ConvoLink Chrome Companion extension connected on ws://127.0.0.1:${this.port}`,
      };
    }
    try {
      const tabs = await this.listTabs();
      const labels = clients.map((c) => `${c.browserFamily} [${c.profileLabel}]`).join(", ");
      return {
        ok: true, adapterId: this.id, endpoint: `ws://127.0.0.1:${this.port} (${labels})`,
        openTabsCount: tabs.length, latencyMs: Date.now() - start, capabilities: this.capabilities,
      };
    } catch (err: unknown) {
      return {
        ok: false, adapterId: this.id, endpoint: `ws://127.0.0.1:${this.port}`,
        openTabsCount: 0, latencyMs: Date.now() - start, error: (err as Error).message, capabilities: this.capabilities,
      };
    }
  }

  public async listTabs(): Promise<TabDescriptor[]> {
    const clients = this.registry.getAll();
    const aggregated: TabDescriptor[] = [];

    for (const client of clients) {
      try {
        const res = await this.sendRequestToClient<any>(client.ws, "LIST_TABS", {});
        const rawList = Array.isArray(res) ? res : res?.tabs || [];
        const mapped = rawList.map((t: any) => {
          const rawId = String(t.tabId ?? t.targetId);
          const targetId = clients.length > 1 ? `${client.clientId}::${rawId}` : rawId;
          const badge = clients.length > 1 ? `[${client.profileLabel || client.browserFamily}] ` : "";
          return {
            targetId,
            title: `${badge}${t.title || "Untitled Tab"}`,
            url: t.url,
          };
        });
        client.tabs = mapped;
        aggregated.push(...mapped);
      } catch {}
    }

    return aggregated;
  }

  public attach(targetId: string): Promise<SessionHandle> {
    return this.sendAction("ATTACH", targetId).then(() => ({
      sessionId: `ext-${targetId}-${Date.now()}`, targetId, adapterId: this.id,
    }));
  }
  public detach(handle: SessionHandle): Promise<void> {
    return this.sendAction("DETACH", handle.targetId).catch(() => {});
  }
  public keepAliveInBackground(_handle: SessionHandle): Promise<void> { return Promise.resolve(); }
  public bringToFront(h: SessionHandle): Promise<void> { return this.sendAction("BRING_TO_FRONT", h.targetId); }

  public async evaluate<T>(h: SessionHandle, expression: string): Promise<T> {
    const res = await this.sendRequest<{ value: T }>("EVALUATE", { targetId: h.targetId, expression }, h.targetId);
    return (res as unknown as { value: T })?.value;
  }

  public fillText(h: SessionHandle, selector: string, text: string): Promise<void> {
    return this.sendAction("FILL_TEXT", h.targetId, { selector, text });
  }
  public click(h: SessionHandle, selector: string): Promise<void> {
    return this.sendAction("CLICK", h.targetId, { selector });
  }
  public pressKey(h: SessionHandle, selector: string, key: string): Promise<void> {
    return this.sendAction("PRESS_KEY", h.targetId, { selector, key });
  }
  public setInputFiles(): Promise<void> { return Promise.resolve(); }

  private sendAction(type: string, targetId: string, extra: Record<string, unknown> = {}): Promise<void> {
    return this.sendRequest(type, { targetId, ...extra }, targetId);
  }

  private async sendRequest<T>(type: string, payload: Record<string, unknown>, targetId?: string): Promise<T> {
    const targetRoute = targetId ? this.registry.findClientForTarget(targetId) : null;
    const client = targetRoute?.client ?? this.registry.getPrimary();
    if (!client) {
      throw new BrowserConnectionError(`ws://127.0.0.1:${this.port}`, "Extension is not connected");
    }
    const cleanPayload = targetRoute ? { ...payload, targetId: targetRoute.rawTabId } : payload;
    return this.sendRequestToClient<T>(client.ws, type, cleanPayload);
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
