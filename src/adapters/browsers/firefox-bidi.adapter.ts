import type {
  BrowserPort, BrowserCapabilities, SessionHandle, TabDescriptor, TransportHealth,
} from "../../core/ports/browser.port.js";
import { BrowserConnectionError, TabNotFoundError } from "../../core/errors/bridge-errors.js";
import { deserializeBidiRemoteValue } from "./bidi-deserializer.js";
import { createBidiSocket } from "./firefox-bidi.ws.js";
import { computeTargetCoordinates, getHandTransitionPause, type Point } from "../common/human-motor.js";
import { dispatchBidiHumanClick, dispatchBidiKeyPress, dispatchBidiPaste } from "./firefox-bidi.input.js";

export { deserializeBidiRemoteValue };
export type BidiMessenger = (method: string, params: Record<string, unknown>) => Promise<any>;

export class FirefoxBidiAdapter implements BrowserPort {
  public readonly id = "firefox-bidi" as const;
  public readonly capabilities: BrowserCapabilities = {
    protocol: "webdriver-bidi", browserFamily: "firefox", supportsBackgroundLifecycle: false, supportsFileDownloads: false, supportsTabManagement: true,
  };

  private readonly port: number;
  private readonly messenger?: BidiMessenger;
  private socket?: WebSocket;
  private exitCleanupRegistered = false;
  private messageCounter = 0;
  private readonly pending = new Map<number, { resolve: (val: any) => void; reject: (err: Error) => void }>();

  constructor(port: number = 9223, messenger?: BidiMessenger) {
    this.port = port;
    this.messenger = messenger;
  }

  public async health(): Promise<TransportHealth> {
    const start = Date.now();
    try {
      const tabs = await this.listTabs();
      return { ok: true, adapterId: this.id, endpoint: `ws://127.0.0.1:${this.port}/session`, openTabsCount: tabs.length, latencyMs: Date.now() - start, capabilities: this.capabilities };
    } catch (err: unknown) {
      return { ok: false, adapterId: this.id, endpoint: `ws://127.0.0.1:${this.port}/session`, openTabsCount: 0, latencyMs: Date.now() - start, error: (err as Error).message, capabilities: this.capabilities };
    }
  }

  public async listTabs(): Promise<TabDescriptor[]> {
    try {
      const res = await this.send("browsingContext.getTree", {});
      const contexts = res.contexts || [];
      const tabs: TabDescriptor[] = [];
      for (const c of contexts) {
        let title = c.url || "Firefox Tab";
        try {
          const evalRes = await this.send("script.evaluate", { expression: "document.title", target: { context: c.context }, awaitPromise: true, resultOwnership: "none" });
          if (evalRes?.result?.value) title = String(evalRes.result.value);
        } catch {}
        tabs.push({ targetId: c.context, url: c.url || "about:blank", title: title || c.url || "Firefox Tab" });
      }
      return tabs;
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

  public async detach(_handle: SessionHandle): Promise<void> {}

  /**
   * Firefox allows a single BiDi session. A process that exits without
   * session.end blocks every later command until the browser restarts, so the
   * socket is told to end the session even on an abrupt exit.
   */
  private registerExitCleanup(): void {
    if (this.exitCleanupRegistered) return;
    this.exitCleanupRegistered = true;

    const release = () => {
      try {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
          this.socket.send(JSON.stringify({ id: -1, method: "session.end", params: {} }));
          this.socket.close();
        }
      } catch {}
    };

    process.once("exit", release);
    // `timeout` and Ctrl-C terminate with a signal, and Bun does not fire "exit"
    // for those, which left the only BiDi session occupied.
    for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
      process.once(signal, () => {
        release();
        setTimeout(() => process.exit(0), 60);
      });
    }
  }

  public async disconnect(): Promise<void> {
    if (this.messenger) {
      try { await this.messenger("session.end", {}); } catch {}
      return;
    }
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      try { await this.sendRaw(this.socket, "session.end", {}); } catch {}
      try { this.socket.close(); } catch {}
      this.socket = undefined;
    }
  }

  public async keepAliveInBackground(_handle: SessionHandle): Promise<void> {}
  public async bringToFront(_handle: SessionHandle): Promise<void> {}

  public async evaluate<T>(handle: SessionHandle, expression: string): Promise<T> {
    const res = await this.send("script.evaluate", { expression, target: { context: handle.targetId }, awaitPromise: true, resultOwnership: "none" });
    if (res.type === "exception") throw new Error(`BiDi Script Exception: ${res.exceptionDetails?.text || "Unknown"}`);
    return deserializeBidiRemoteValue(res.result) as T;
  }

  public async fillText(handle: SessionHandle, selector: string, text: string): Promise<void> {
    await this.click(handle, selector);
    const pause = getHandTransitionPause();
    if (pause > 0) await new Promise((r) => setTimeout(r, pause));
    await dispatchBidiPaste((m, p) => this.send(m, p), handle.targetId, text, (expr) => this.evaluate(handle, expr));
  }

  public async click(handle: SessionHandle, selector: string): Promise<void> {
    try {
      const box = await this.evaluate<{ left?: number; top?: number; width?: number; height?: number; x?: number; y?: number } | null>(
        handle,
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return null;
          el.scrollIntoView({ block: 'center', inline: 'center' });
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, width: r.width, height: r.height };
        })()`,
      );
      if (box) {
        let target: Point;
        if (typeof box.x === "number" && typeof box.y === "number") {
          target = { x: box.x, y: box.y };
        } else if (typeof box.left === "number" && typeof box.top === "number") {
          const width = box.width ?? 10;
          const height = box.height ?? 10;
          target = computeTargetCoordinates({ left: box.left, top: box.top, width, height });
        } else {
          throw new Error("Invalid coords");
        }
        await dispatchBidiHumanClick((m, p) => this.send(m, p), handle.targetId, target);
        return;
      }
    } catch {}
    await this.evaluate(handle, `(() => { document.querySelector(${JSON.stringify(selector)})?.click(); })()`);
  }

  public async pressKey(handle: SessionHandle, selector: string, key: string): Promise<void> {
    try {
      await dispatchBidiKeyPress((m, p) => this.send(m, p), handle.targetId, key);
      return;
    } catch {}
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
    if (url && url !== "about:blank") await this.send("browsingContext.navigate", { context: contextId, url, wait: "interactive" });
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

  private async sendRaw(ws: WebSocket, method: string, params: Record<string, unknown>): Promise<any> {
    const id = ++this.messageCounter;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  private async send(method: string, params: Record<string, unknown>): Promise<any> {
    if (this.messenger) return this.messenger(method, params);
    const ws = await this.ensureSocket();
    return this.sendRaw(ws, method, params);
  }

  private async ensureSocket(): Promise<WebSocket> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return this.socket;
    this.socket = await createBidiSocket(this.port, this.pending, (ws, method, params) => this.sendRaw(ws, method, params));
    this.registerExitCleanup();
    return this.socket;
  }
}
