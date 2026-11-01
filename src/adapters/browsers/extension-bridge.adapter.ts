import type { Server, ServerWebSocket } from "bun";
import type {
  BrowserPort,
  BrowserCapabilities,
  SessionHandle,
  TabDescriptor,
  TransportHealth,
} from "../../core/ports/browser.port.js";
import { BrowserConnectionError, TabNotFoundError } from "../../core/errors/bridge-errors.js";

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
  private activeClient: ServerWebSocket<unknown> | null = null;
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private messageCounter = 0;
  private profileName: string | null = null;

  constructor(port = 9224) {
    this.port = port;
  }

  public async start(): Promise<void> {
    if (this.server) return;
    this.server = Bun.serve({
      port: this.port,
      hostname: "127.0.0.1",
      fetch(req, server) {
        if (server.upgrade(req, { data: undefined })) return undefined;
        return new Response("ConvoLink Extension Bridge", { status: 200 });
      },
      websocket: {
        open: (ws) => {
          this.activeClient = ws;
        },
        message: (_ws, message) => {
          this.handleIncomingMessage(message.toString());
        },
        close: (ws) => {
          if (this.activeClient === ws) {
            this.activeClient = null;
            this.profileName = null;
          }
        },
      },
    });
  }

  public async stop(): Promise<void> {
    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }
    this.activeClient = null;
    for (const req of this.pendingRequests.values()) {
      req.reject(new Error("ExtensionBridgeAdapter stopped"));
    }
    this.pendingRequests.clear();
  }

  public async health(): Promise<TransportHealth> {
    const start = Date.now();
    await this.start();
    if (!this.activeClient) {
      return {
        ok: false,
        adapterId: this.id,
        endpoint: `ws://127.0.0.1:${this.port}`,
        openTabsCount: 0,
        latencyMs: Date.now() - start,
        error: `No ConvoLink Chrome Companion extension connected on ws://127.0.0.1:${this.port}`,
        capabilities: this.capabilities,
      };
    }
    try {
      const tabs = await this.listTabs();
      return {
        ok: true,
        adapterId: this.id,
        endpoint: `ws://127.0.0.1:${this.port} (${this.profileName ?? "Chrome"})`,
        openTabsCount: tabs.length,
        latencyMs: Date.now() - start,
        capabilities: this.capabilities,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        adapterId: this.id,
        endpoint: `ws://127.0.0.1:${this.port}`,
        openTabsCount: 0,
        latencyMs: Date.now() - start,
        error: (err as Error).message,
        capabilities: this.capabilities,
      };
    }
  }

  public async listTabs(): Promise<TabDescriptor[]> {
    const res = await this.sendRequest<{ tabs: TabDescriptor[] }>("LIST_TABS", {});
    return (res as unknown as TabDescriptor[]) ?? [];
  }

  public async attach(targetId: string): Promise<SessionHandle> {
    await this.sendRequest("ATTACH", { targetId });
    return { sessionId: `ext-session-${targetId}-${Date.now()}`, targetId, adapterId: this.id };
  }

  public async detach(handle: SessionHandle): Promise<void> {
    await this.sendRequest("DETACH", { targetId: handle.targetId }).catch(() => {});
  }

  public async keepAliveInBackground(_handle: SessionHandle): Promise<void> {}
  public async bringToFront(handle: SessionHandle): Promise<void> {
    await this.sendRequest("BRING_TO_FRONT", { targetId: handle.targetId });
  }

  public async evaluate<T>(handle: SessionHandle, expression: string): Promise<T> {
    const res = await this.sendRequest<{ value: T }>("EVALUATE", { targetId: handle.targetId, expression });
    return (res as unknown as { value: T })?.value;
  }

  public async fillText(handle: SessionHandle, selector: string, text: string): Promise<void> {
    await this.sendRequest("FILL_TEXT", { targetId: handle.targetId, selector, text });
  }

  public async click(handle: SessionHandle, selector: string): Promise<void> {
    await this.sendRequest("CLICK", { targetId: handle.targetId, selector });
  }

  public async pressKey(handle: SessionHandle, selector: string, key: string): Promise<void> {
    await this.sendRequest("PRESS_KEY", { targetId: handle.targetId, selector, key });
  }

  public async setInputFiles(_handle: SessionHandle, _selector: string, _filePaths: string[]): Promise<void> {}

  private async sendRequest<T>(type: string, payload: Record<string, unknown>): Promise<T> {
    if (!this.activeClient) {
      throw new BrowserConnectionError(`ws://127.0.0.1:${this.port}`, "Extension is not connected");
    }
    const id = ++this.messageCounter;
    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve: resolve as (val: unknown) => void, reject });
      this.activeClient!.send(JSON.stringify({ id, type, ...payload }));
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Extension bridge request ${type} timed out`));
        }
      }, 10000);
    });
  }

  private handleIncomingMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === "HANDSHAKE") {
        this.profileName = msg.profileName || "Chrome Profile";
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
