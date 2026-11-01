import type {
  BrowserPort,
  BrowserCapabilities,
  SessionHandle,
  TabDescriptor,
  TransportHealth,
} from "../../core/ports/browser.port.js";
import { BrowserConnectionError, TabNotFoundError } from "../../core/errors/bridge-errors.js";
import type { CdpTarget, PendingMessage } from "./raw-cdp.types.js";
import { getDownloadFileExpr } from "./raw-cdp.scripts.js";

export class RawCdpAdapter implements BrowserPort {
  public readonly id = "raw-cdp" as const;
  public readonly capabilities: BrowserCapabilities = {
    protocol: "cdp", browserFamily: "chromium", supportsBackgroundLifecycle: true, supportsFileDownloads: true, supportsTabManagement: true,
  };
  private readonly port: number;
  private readonly activeSockets = new Map<string, WebSocket>();
  private readonly pendingRequests = new Map<string, Map<number, PendingMessage>>();
  private messageCounter = 0;

  constructor(portOrEndpoint: number | string = 9222) {
    if (typeof portOrEndpoint === "number") this.port = portOrEndpoint;
    else {
      const match = portOrEndpoint.match(/:(\d+)/);
      this.port = match && match[1] ? parseInt(match[1], 10) : 9222;
    }
  }

  public async health(): Promise<TransportHealth> {
    const start = Date.now();
    try {
      const tabs = await this.listTabs();
      return { ok: true, adapterId: this.id, endpoint: `http://127.0.0.1:${this.port}`, openTabsCount: tabs.length, latencyMs: Date.now() - start };
    } catch (err: unknown) {
      return { ok: false, adapterId: this.id, endpoint: `http://127.0.0.1:${this.port}`, openTabsCount: 0, latencyMs: Date.now() - start, error: (err as Error).message };
    }
  }

  public async listTabs(): Promise<TabDescriptor[]> {
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/json/list`);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      const rawTargets = (await res.json()) as CdpTarget[];
      return rawTargets
        .filter((t) => t.type === "page" && !t.url.startsWith("chrome://") && !t.url.startsWith("chrome-extension://"))
        .map((t) => ({ targetId: t.id, url: t.url, title: t.title, webSocketDebuggerUrl: t.webSocketDebuggerUrl }));
    } catch (err: unknown) {
      throw new BrowserConnectionError(`127.0.0.1:${this.port}`, (err as Error).message);
    }
  }

  public async attach(targetId: string): Promise<SessionHandle> {
    const tabs = await this.listTabs();
    const target = tabs.find((t) => t.targetId === targetId);
    if (!target || !target.webSocketDebuggerUrl) {
      throw new TabNotFoundError(undefined, targetId);
    }

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
        req.reject(new BrowserConnectionError(`127.0.0.1:${this.port}`, `Tab ${targetId} closed: ${reason}`));
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
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        const res = await this.send(handle.targetId, "Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        });
        if (res?.exceptionDetails) {
          const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text || JSON.stringify(res.exceptionDetails);
          throw new Error(`In-page evaluation error: ${desc}`);
        }
        return res?.result?.value as T;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("Cannot find default execution context") && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 200));
          continue;
        }
        throw err;
      }
    }
    throw new Error("Evaluation timed out waiting for execution context");
  }

  public async fillText(handle: SessionHandle, selector: string, text: string): Promise<void> {
    await this.evaluate(handle, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.focus(); })()`);
    await this.send(handle.targetId, "Input.insertText", { text });
  }

  public async click(handle: SessionHandle, selector: string): Promise<void> {
    await this.evaluate(handle, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) el.click(); })()`);
  }

  public async pressKey(handle: SessionHandle, selector: string, key: string): Promise<void> {
    const expr = `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el) { el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true })); } })()`;
    await this.evaluate(handle, expr);
  }

  public async setInputFiles(handle: SessionHandle, selector: string, _filePaths: string[]): Promise<void> {
    await this.evaluate(handle, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (el && 'files' in el) el.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  }

  public async createTab(url: string): Promise<TabDescriptor> {
    const res = await fetch(`http://127.0.0.1:${this.port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to create tab`);
    const data = (await res.json()) as CdpTarget;
    return { targetId: data.id, url: data.url, title: data.title, webSocketDebuggerUrl: data.webSocketDebuggerUrl };
  }

  public async closeTab(targetId: string): Promise<void> {
    await fetch(`http://127.0.0.1:${this.port}/json/close/${targetId}`);
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
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`No active WebSocket for target ${targetId}`));
    }

    const id = ++this.messageCounter;
    const pending = this.pendingRequests.get(targetId);

    return new Promise((resolve, reject) => {
      if (pending) pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
}
