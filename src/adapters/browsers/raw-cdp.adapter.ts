import type {
  BrowserPort,
  BrowserCapabilities,
  SessionHandle,
  TabDescriptor,
  TransportHealth,
} from "../../core/ports/browser.port.js";
import { BrowserConnectionError, TabNotFoundError } from "../../core/errors/bridge-errors.js";
import { PlatformEnv } from "../../core/env/platform-env.js";
import type { CdpTarget, PendingMessage } from "./raw-cdp.types.js";
import {
  getDownloadFileExpr,
  getFocusExpr,
  getClickExpr,
  getKeyPressExpr,
  getChangeExpr,
} from "./raw-cdp.scripts.js";
import { queryCdpTargets } from "./raw-cdp.targets.js";
import { evaluateCdpExpression } from "./raw-cdp.eval.js";

export interface RawCdpOptions {
  isWsl?: () => boolean;
  getWslGateway?: () => string | null;
}

export class RawCdpAdapter implements BrowserPort {
  public readonly id = "raw-cdp" as const;
  public readonly capabilities: BrowserCapabilities = {
    protocol: "cdp", browserFamily: "chromium", supportsBackgroundLifecycle: true, supportsFileDownloads: true, supportsTabManagement: true,
  };
  private readonly port: number;
  private host = "127.0.0.1";
  private readonly isWsl: () => boolean;
  private readonly getWslGateway: () => string | null;
  private readonly activeSockets = new Map<string, WebSocket>();
  private readonly pendingRequests = new Map<string, Map<number, PendingMessage>>();
  private messageCounter = 0;

  constructor(portOrEndpoint: number | string = 9222, options: RawCdpOptions = {}) {
    this.isWsl = options.isWsl ?? (() => PlatformEnv.isWsl());
    this.getWslGateway = options.getWslGateway ?? (() => PlatformEnv.getWslGatewayIp());
    if (typeof portOrEndpoint === "number") this.port = portOrEndpoint;
    else {
      const match = portOrEndpoint.match(/:(\d+)/);
      this.port = match && match[1] ? parseInt(match[1], 10) : 9222;
      const hostMatch = portOrEndpoint.match(/^(?:https?:\/\/)?([^:/]+)/);
      if (hostMatch && hostMatch[1] && !hostMatch[1].startsWith("http")) this.host = hostMatch[1];
    }
  }

  public async health(): Promise<TransportHealth> {
    const start = Date.now();
    try {
      const tabs = await this.listTabs();
      return { ok: true, adapterId: this.id, endpoint: `http://${this.host}:${this.port}`, openTabsCount: tabs.length, latencyMs: Date.now() - start };
    } catch (err: unknown) {
      return { ok: false, adapterId: this.id, endpoint: `http://${this.host}:${this.port}`, openTabsCount: 0, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  public async listTabs(): Promise<TabDescriptor[]> {
    try {
      return await queryCdpTargets(this.host, this.port);
    } catch (err: unknown) {
      if (this.host === "127.0.0.1" && this.isWsl()) {
        const gw = this.getWslGateway();
        if (gw) {
          try {
            const tabs = await queryCdpTargets(gw, this.port);
            this.host = gw;
            return tabs;
          } catch {}
        }
      }
      throw new BrowserConnectionError(`${this.host}:${this.port}`, (err as Error).message);
    }
  }

  public async attach(targetId: string): Promise<SessionHandle> {
    const tabs = await this.listTabs();
    const target = tabs.find((t) => t.targetId === targetId);
    if (!target || !target.webSocketDebuggerUrl) throw new TabNotFoundError(undefined, targetId);

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map<number, PendingMessage>();
    this.pendingRequests.set(targetId, pending);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WebSocket handshake timed out")), 5000);
      ws.onopen = () => { clearTimeout(timer); resolve(); };
      ws.onerror = (e) => { clearTimeout(timer); reject(new Error(`WebSocket error on tab ${targetId}: ${e}`)); };
    });

    const cleanup = (reason: string) => {
      for (const req of pending.values()) {
        req.reject(new BrowserConnectionError(`${this.host}:${this.port}`, `Tab ${targetId} closed: ${reason}`));
      }
      pending.clear();
      this.activeSockets.delete(targetId);
      this.pendingRequests.delete(targetId);
    };

    ws.onclose = () => cleanup("connection closed");
    ws.onerror = (e) => cleanup(String(e));
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data.toString());
        if (msg.id && pending.has(msg.id)) {
          const handler = pending.get(msg.id)!;
          pending.delete(msg.id);
          if (msg.error) handler.reject(new Error(msg.error.message || "CDP error"));
          else handler.resolve(msg.result);
        }
      } catch {}
    };

    this.activeSockets.set(targetId, ws);
    return { sessionId: `cdp-session-${targetId}-${Date.now()}`, targetId, adapterId: this.id };
  }

  public async detach(handle: SessionHandle): Promise<void> {
    const ws = this.activeSockets.get(handle.targetId);
    if (ws) {
      this.activeSockets.delete(handle.targetId);
      this.pendingRequests.delete(handle.targetId);
      try { ws.close(); } catch {}
    }
  }

  public async keepAliveInBackground(handle: SessionHandle): Promise<void> {
    await this.send(handle.targetId, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
    await this.send(handle.targetId, "Page.setWebLifecycleState", { state: "active" }).catch(() => {});
  }

  public async bringToFront(handle: SessionHandle): Promise<void> {
    await this.send(handle.targetId, "Page.bringToFront", {});
  }

  public async evaluate<T>(handle: SessionHandle, expression: string): Promise<T> {
    return evaluateCdpExpression<T>(
      (method, params) => this.send(handle.targetId, method, params),
      expression,
    );
  }

  public async fillText(handle: SessionHandle, selector: string, text: string): Promise<void> {
    await this.evaluate(handle, getFocusExpr(selector));
    await this.send(handle.targetId, "Input.insertText", { text });
  }

  public async click(handle: SessionHandle, selector: string): Promise<void> {
    await this.evaluate(handle, getClickExpr(selector));
  }

  public async pressKey(handle: SessionHandle, selector: string, key: string): Promise<void> {
    await this.evaluate(handle, getKeyPressExpr(selector, key));
  }

  public async setInputFiles(handle: SessionHandle, selector: string, _paths: string[]): Promise<void> {
    await this.evaluate(handle, getChangeExpr(selector));
  }

  public async createTab(url: string): Promise<TabDescriptor> {
    const res = await fetch(`http://${this.host}:${this.port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to create tab`);
    const data = (await res.json()) as CdpTarget;
    return { targetId: data.id, url: data.url, title: data.title, webSocketDebuggerUrl: data.webSocketDebuggerUrl };
  }

  public async closeTab(targetId: string): Promise<void> {
    await fetch(`http://${this.host}:${this.port}/json/close/${targetId}`);
  }

  public async navigate(handle: SessionHandle, url: string): Promise<void> {
    await this.evaluate(handle, `(() => { window.location.href = ${JSON.stringify(url)}; })()`);
  }

  public async goBack(handle: SessionHandle): Promise<void> {
    await this.evaluate(handle, `(() => { window.history.back(); })()`);
  }

  public async downloadFile(handle: SessionHandle, url: string): Promise<Buffer> {
    const dataUrl = await this.evaluate<string>(handle, getDownloadFileExpr(url));
    if (!dataUrl?.includes(",")) throw new Error(`Failed to download file from ${url}`);
    return Buffer.from(dataUrl.split(",")[1]!, "base64");
  }

  private send(targetId: string, method: string, params: Record<string, unknown>): Promise<any> {
    const ws = this.activeSockets.get(targetId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`No active WebSocket for target ${targetId}`));
    const id = ++this.messageCounter;
    const pending = this.pendingRequests.get(targetId);
    return new Promise((resolve, reject) => {
      if (pending) pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
}
