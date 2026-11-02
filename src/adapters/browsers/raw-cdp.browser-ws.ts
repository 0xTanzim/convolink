import type { TabDescriptor } from "../../core/ports/browser.port.js";
import { BrowserConnectionError } from "../../core/errors/bridge-errors.js";

export interface BrowserWsClientOptions {
  readonly createWebSocket?: (url: string) => WebSocket;
}

export class BrowserWsClient {
  private ws: WebSocket | null = null;
  private messageCounter = 0;
  private readonly pending = new Map<number, { resolve: (res: any) => void; reject: (err: any) => void }>();
  private readonly targetSessions = new Map<string, string>(); // targetId -> sessionId
  private readonly sessionTargets = new Map<string, string>(); // sessionId -> targetId
  private readonly targetRefCounts = new Map<string, number>(); // targetId -> refCount
  private readonly createWs: (url: string) => WebSocket;

  public constructor(options: BrowserWsClientOptions = {}) {
    this.createWs = options.createWebSocket ?? ((url) => new WebSocket(url));
  }

  public isOpen(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public async connect(wsUrl: string, timeoutMs: number = 30000): Promise<void> {
    if (this.isOpen()) return;
    const ws = this.createWs(wsUrl);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Browser WebSocket handshake timed out")), timeoutMs);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = (e) => { clearTimeout(timer); reject(new Error(`Browser WebSocket error: ${e}`)); };
    });

    ws.onclose = () => this.handleClose("connection closed");
    ws.onerror = (e) => this.handleClose(String(e));
    ws.onmessage = (event) => this.handleMessage(event.data.toString());
    this.ws = ws;
  }

  public async getTargets(): Promise<TabDescriptor[]> {
    const res = await this.send("Target.getTargets");
    const targets: any[] = res?.targetInfos ?? [];
    return targets
      .filter((t) => t.type === "page" && !t.url.startsWith("chrome://") && !t.url.startsWith("chrome-extension://"))
      .map((t) => ({
        targetId: t.targetId,
        url: t.url,
        title: t.title,
        webSocketDebuggerUrl: this.ws?.url,
      }));
  }

  public async createTarget(url: string): Promise<TabDescriptor> {
    const res = await this.send("Target.createTarget", { url });
    return { targetId: res.targetId, url, title: "" };
  }

  public async closeTarget(targetId: string): Promise<void> {
    const sessionId = this.targetSessions.get(targetId);
    if (sessionId) {
      this.targetRefCounts.delete(targetId);
      this.targetSessions.delete(targetId);
      this.sessionTargets.delete(sessionId);
    }
    await this.send("Target.closeTarget", { targetId });
  }

  public async attachToTarget(targetId: string): Promise<string> {
    const existing = this.targetSessions.get(targetId);
    if (existing) {
      const currentRef = this.targetRefCounts.get(targetId) ?? 1;
      this.targetRefCounts.set(targetId, currentRef + 1);
      return existing;
    }
    const res = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const sessionId = res.sessionId;
    this.targetSessions.set(targetId, sessionId);
    this.sessionTargets.set(sessionId, targetId);
    this.targetRefCounts.set(targetId, 1);
    return sessionId;
  }

  public async detachFromTarget(targetId: string): Promise<void> {
    const sessionId = this.targetSessions.get(targetId);
    if (!sessionId) return;
    const currentRef = (this.targetRefCounts.get(targetId) ?? 1) - 1;
    if (currentRef > 0) {
      this.targetRefCounts.set(targetId, currentRef);
      return;
    }
    this.targetRefCounts.delete(targetId);
    this.targetSessions.delete(targetId);
    this.sessionTargets.delete(sessionId);
    await this.send("Target.detachFromTarget", { sessionId }).catch(() => {});
  }

  public sendCommand(targetId: string, method: string, params: Record<string, unknown>): Promise<any> {
    const sessionId = this.targetSessions.get(targetId);
    if (!sessionId) {
      return Promise.reject(new Error(`Target ${targetId} is not attached to a flattened session`));
    }
    return this.send(method, params, sessionId);
  }

  public close(): void {
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.handleClose("closed by client");
    }
  }

  private send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> {
    if (!this.isOpen() || !this.ws) {
      return Promise.reject(new BrowserConnectionError("browser-ws", "Browser WebSocket is not connected"));
    }
    const id = ++this.messageCounter;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify(payload));
    });
  }

  private handleMessage(raw: string): void {
    try {
      const msg = JSON.parse(raw);
      if (msg.id && this.pending.has(msg.id)) {
        const handler = this.pending.get(msg.id)!;
        this.pending.delete(msg.id);
        if (msg.error) handler.reject(new Error(msg.error.message || "CDP error"));
        else handler.resolve(msg.result);
      }
    } catch {}
  }

  private handleClose(reason: string): void {
    this.ws = null;
    for (const req of this.pending.values()) {
      req.reject(new BrowserConnectionError("browser-ws", `Browser WS closed: ${reason}`));
    }
    this.pending.clear();
    this.targetSessions.clear();
    this.sessionTargets.clear();
  }
}
