import type {
  BrowserPort,
  BrowserCapabilities,
  SessionHandle,
  TabDescriptor,
  TransportHealth,
} from "../../core/ports/browser.port.js";
import { BrowserConnectionError, TabNotFoundError } from "../../core/errors/bridge-errors.js";
import { deserializeBidiRemoteValue } from "./bidi-deserializer.js";

export { deserializeBidiRemoteValue };
export type BidiMessenger = (method: string, params: Record<string, unknown>) => Promise<any>;

export class FirefoxBidiAdapter implements BrowserPort {
  public readonly id = "firefox-bidi" as const;
  public readonly capabilities: BrowserCapabilities = {
    protocol: "webdriver-bidi",
    browserFamily: "firefox",
    supportsBackgroundLifecycle: false,
    supportsFileDownloads: false,
    supportsTabManagement: true,
  };

  private readonly port: number;
  private readonly messenger?: BidiMessenger;
  private socket?: WebSocket;
  private messageCounter = 0;
  private readonly pending = new Map<number, { resolve: (val: any) => void; reject: (err: Error) => void }>();

  constructor(port: number = 9222, messenger?: BidiMessenger) {
    this.port = port;
    this.messenger = messenger;
  }

  public async health(): Promise<TransportHealth> {
    const start = Date.now();
    try {
      const tabs = await this.listTabs();
      return {
        ok: true,
        adapterId: this.id,
        endpoint: `ws://127.0.0.1:${this.port}/session`,
        openTabsCount: tabs.length,
        latencyMs: Date.now() - start,
        capabilities: this.capabilities,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        adapterId: this.id,
        endpoint: `ws://127.0.0.1:${this.port}/session`,
        openTabsCount: 0,
        latencyMs: Date.now() - start,
        error: (err as Error).message,
        capabilities: this.capabilities,
      };
    }
  }

  public async listTabs(): Promise<TabDescriptor[]> {
    try {
      const res = await this.send("browsingContext.getTree", {});
      const contexts = res.contexts || [];
      return contexts.map((c: any) => ({
        targetId: c.context,
        url: c.url || "about:blank",
        title: c.url || "Firefox Tab",
      }));
    } catch (err: unknown) {
      throw new BrowserConnectionError(`127.0.0.1:${this.port}`, (err as Error).message);
    }
  }

  public async attach(targetId: string): Promise<SessionHandle> {
    const tabs = await this.listTabs();
    const found = tabs.find((t) => t.targetId === targetId);
    if (!found) throw new TabNotFoundError(undefined, targetId);
    return { sessionId: `bidi-${Date.now()}`, targetId, adapterId: this.id };
  }

  public async detach(_handle: SessionHandle): Promise<void> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close();
      this.socket = undefined;
    }
  }

  public async keepAliveInBackground(_handle: SessionHandle): Promise<void> {}
  public async bringToFront(_handle: SessionHandle): Promise<void> {}

  public async evaluate<T>(handle: SessionHandle, expression: string): Promise<T> {
    const res = await this.send("script.evaluate", {
      expression,
      target: { context: handle.targetId },
      awaitPromise: true,
      resultOwnership: "none",
    });

    if (res.type === "exception") {
      throw new Error(`BiDi Script Exception: ${res.exceptionDetails?.text || "Unknown"}`);
    }
    return deserializeBidiRemoteValue(res.result) as T;
  }

  public async fillText(handle: SessionHandle, selector: string, text: string): Promise<void> {
    const expr = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) throw new Error("Element not found: " + ${JSON.stringify(selector)});
      el.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, ${JSON.stringify(text)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
    })()`;
    await this.evaluate(handle, expr);
  }

  public async click(handle: SessionHandle, selector: string): Promise<void> {
    await this.evaluate(handle, `(() => { document.querySelector(${JSON.stringify(selector)})?.click(); })()`);
  }

  public async pressKey(handle: SessionHandle, selector: string, key: string): Promise<void> {
    const expr = `(() => {
      const el = document.querySelector(${JSON.stringify(selector)}) || document.body;
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, code: ${JSON.stringify(key)}, bubbles: true }));
    })()`;
    await this.evaluate(handle, expr);
  }

  public async setInputFiles(handle: SessionHandle, selector: string, _filePaths: string[]): Promise<void> {
    await this.evaluate(handle, `(() => { document.querySelector(${JSON.stringify(selector)})?.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  }

  public async createTab(url: string): Promise<TabDescriptor> {
    const res = await this.send("browsingContext.create", { type: "tab" });
    const contextId = res.context;
    if (url && url !== "about:blank") {
      await this.send("browsingContext.navigate", { context: contextId, url, wait: "interactive" });
    }
    return { targetId: contextId, url, title: `Firefox Tab` };
  }

  public async closeTab(targetId: string): Promise<void> {
    await this.send("browsingContext.close", { context: targetId });
  }

  public async navigate(handle: SessionHandle, url: string): Promise<void> {
    await this.send("browsingContext.navigate", { context: handle.targetId, url, wait: "interactive" });
  }

  public async goBack(handle: SessionHandle): Promise<void> {
    await this.evaluate(handle, `(() => { window.history.back(); })()`);
  }

  private async send(method: string, params: Record<string, unknown>): Promise<any> {
    if (this.messenger) {
      return this.messenger(method, params);
    }
    const ws = await this.ensureSocket();
    const id = ++this.messageCounter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  private async ensureSocket(): Promise<WebSocket> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return this.socket;
    const wsUrl = `ws://127.0.0.1:${this.port}/session`;
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("BiDi WebSocket timeout")), 5000);
      ws.onopen = () => { clearTimeout(timeout); resolve(); };
      ws.onerror = (err) => { clearTimeout(timeout); reject(err); };
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data.toString());
          const handler = this.pending.get(data.id);
          if (handler) {
            this.pending.delete(data.id);
            if (data.type === "error") handler.reject(new Error(data.message));
            else handler.resolve(data.result);
          }
        } catch {}
      };
    });
    this.socket = ws;
    return ws;
  }
}
