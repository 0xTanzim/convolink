import type { BrowserPort, BrowserCapabilities, SessionHandle, TabDescriptor, TransportHealth } from "../../core/ports/browser.port.js";
import { BrowserConnectionError, TabNotFoundError } from "../../core/errors/bridge-errors.js";
import { PlatformEnv } from "../../core/env/platform-env.js";
import type { PendingMessage } from "./raw-cdp.types.js";
import { getDownloadFileExpr, getChangeExpr } from "./raw-cdp.scripts.js";
import { queryCdpTargets, createCdpTab, closeCdpTab, findBrowserWsUrl } from "./raw-cdp.targets.js";
import { evaluateCdpExpression } from "./raw-cdp.eval.js";
import { createCdpSocket } from "./raw-cdp.ws.js";
import { BrowserWsClient } from "./raw-cdp.browser-ws.js";
import { getHandTransitionPause } from "../common/human-motor.js";
import { getStealthPreloadScript } from "../common/stealth-scripts.js";
import { dispatchCdpPaste } from "./raw-cdp.input.js";
import { executeCdpClick, executeCdpKeyPress } from "./raw-cdp.actions.js";

export interface RawCdpOptions {
  isWsl?: () => boolean;
  getWslGateway?: () => string | null;
  browserWsUrl?: string;
  userDataDir?: string;
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
  private readonly browserWsUrl?: string;
  private readonly userDataDir?: string;
  private browserWsClient: BrowserWsClient | null = null;
  private readonly activeSockets = new Map<string, WebSocket>();
  private readonly pendingRequests = new Map<string, Map<number, PendingMessage>>();
  private messageCounter = 0;

  constructor(portOrEndpoint: number | string = 9222, options: RawCdpOptions = {}) {
    this.isWsl = options.isWsl ?? (() => PlatformEnv.isWsl());
    this.getWslGateway = options.getWslGateway ?? (() => PlatformEnv.getWslGatewayIp());
    this.browserWsUrl = options.browserWsUrl;
    this.userDataDir = options.userDataDir;
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

  private async ensureBrowserWs(): Promise<BrowserWsClient | null> {
    if (this.browserWsClient?.isOpen()) return this.browserWsClient;
    const wsUrl = this.browserWsUrl ?? findBrowserWsUrl(this.host, this.port, this.userDataDir);
    if (!wsUrl) return null;
    try {
      const client = new BrowserWsClient();
      await client.connect(wsUrl);
      this.browserWsClient = client;
      return client;
    } catch { return null; }
  }

  public async listTabs(): Promise<TabDescriptor[]> {
    const client = await this.ensureBrowserWs();
    if (client) {
      try {
        const targets = await client.getTargets();
        if (targets.length > 0) return targets;
      } catch {}
    }

    try {
      const tabs = await queryCdpTargets(this.host, this.port);
      if (tabs.length > 0) return tabs;
    } catch {}

    if (this.host === "127.0.0.1" && this.isWsl()) {
      const gw = this.getWslGateway();
      if (gw) {
        try { return await queryCdpTargets(gw, this.port); } catch {}
      }
    }
    throw new BrowserConnectionError(`${this.host}:${this.port}`, "Unable to enumerate tabs via HTTP or Browser WS");
  }

  public async attach(targetId: string): Promise<SessionHandle> {
    const client = await this.ensureBrowserWs();
    if (client) {
      await client.attachToTarget(targetId);
      await this.initStealth(targetId);
      return { sessionId: `cdp-session-${targetId}-${Date.now()}`, targetId, adapterId: this.id };
    }
    const tabs = await this.listTabs();
    const target = tabs.find((t) => t.targetId === targetId);
    if (!target || !target.webSocketDebuggerUrl) throw new TabNotFoundError(undefined, targetId);

    const pending = new Map<number, PendingMessage>();
    this.pendingRequests.set(targetId, pending);
    const ws = await createCdpSocket(target.webSocketDebuggerUrl, targetId, this.host, this.port, pending);
    this.activeSockets.set(targetId, ws);
    await this.initStealth(targetId);
    return { sessionId: `cdp-session-${targetId}-${Date.now()}`, targetId, adapterId: this.id };
  }

  private async initStealth(targetId: string): Promise<void> {
    await this.send(targetId, "Page.enable", {}).catch(() => {});
    await this.send(targetId, "Page.addScriptToEvaluateOnNewDocument", { source: getStealthPreloadScript() }).catch(() => {});
  }

  public async detach(handle: SessionHandle): Promise<void> {
    if (this.browserWsClient?.isOpen()) return this.browserWsClient.detachFromTarget(handle.targetId);
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
    await this.evaluate(handle, `(() => {
      try {
        Object.defineProperty(document, 'hidden', { value: false, configurable: true, writable: true });
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true, writable: true });
        document.hasFocus = () => true;
        window.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new Event('focus'));
      } catch {}
    })()`).catch(() => {});
  }
  public async bringToFront(handle: SessionHandle): Promise<void> { await this.send(handle.targetId, "Page.bringToFront", {}); }
  public async evaluate<T>(handle: SessionHandle, expression: string): Promise<T> {
    return evaluateCdpExpression<T>((method, params) => this.send(handle.targetId, method, params), expression);
  }
  public async fillText(handle: SessionHandle, selector: string, text: string): Promise<void> {
    await this.click(handle, selector);
    const pause = getHandTransitionPause();
    if (pause > 0) await new Promise((r) => setTimeout(r, pause));
    const res = await dispatchCdpPaste((m, p) => this.send(handle.targetId, m, p), handle.targetId, text, (expr) => this.evaluate(handle, expr), selector);
    if (!res.ok || res.length === 0) await this.send(handle.targetId, "Input.insertText", { text }).catch(() => {});
  }
  public async click(handle: SessionHandle, selector: string): Promise<void> {
    return executeCdpClick((expr) => this.evaluate(handle, expr), (m, p) => this.send(handle.targetId, m, p), handle.targetId, selector);
  }
  public async pressKey(handle: SessionHandle, selector: string, key: string): Promise<void> {
    return executeCdpKeyPress((expr) => this.evaluate(handle, expr), (m, p) => this.send(handle.targetId, m, p), handle.targetId, selector, key);
  }
  public async setInputFiles(handle: SessionHandle, selector: string, _paths: string[]): Promise<void> {
    await this.evaluate(handle, getChangeExpr(selector));
  }
  public async createTab(url: string): Promise<TabDescriptor> {
    const client = await this.ensureBrowserWs();
    return client ? client.createTarget(url) : createCdpTab(this.host, this.port, url);
  }
  public async closeTab(targetId: string): Promise<void> {
    const client = await this.ensureBrowserWs();
    return client ? client.closeTarget(targetId) : closeCdpTab(this.host, this.port, targetId);
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
    if (this.browserWsClient?.isOpen()) return this.browserWsClient.sendCommand(targetId, method, params);
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
