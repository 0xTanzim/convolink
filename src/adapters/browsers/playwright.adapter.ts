import { chromium, type Browser, type Page } from "playwright";
import type {
  BrowserPort,
  BrowserCapabilities,
  SessionHandle,
  TabDescriptor,
  TransportHealth,
} from "../../core/ports/browser.port.js";
import { BrowserConnectionError, TabNotFoundError } from "../../core/errors/bridge-errors.js";

type PlaywrightConnectFn = (endpoint: string) => Promise<Browser>;

export class PlaywrightAdapter implements BrowserPort {
  public readonly id = "playwright" as const;
  public readonly capabilities: BrowserCapabilities = {
    protocol: "cdp",
    browserFamily: "chromium",
    supportsBackgroundLifecycle: true,
    supportsFileDownloads: true,
    supportsTabManagement: true,
  };

  private readonly port: number;
  private readonly connectFn: PlaywrightConnectFn;
  private browserInstance: Browser | null = null;
  private pageMap = new Map<string, Page>();

  constructor(portOrEndpoint: number | string = 9222, connectFn?: PlaywrightConnectFn) {
    if (typeof portOrEndpoint === "number") this.port = portOrEndpoint;
    else {
      const match = portOrEndpoint.match(/:(\d+)/);
      this.port = match && match[1] ? parseInt(match[1], 10) : 9222;
    }
    this.connectFn = connectFn ?? ((endpoint: string) => chromium.connectOverCDP(endpoint));
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browserInstance || !this.browserInstance.isConnected()) {
      try {
        this.browserInstance = await this.connectFn(`http://127.0.0.1:${this.port}`);
      } catch (err: unknown) {
        throw new BrowserConnectionError(`127.0.0.1:${this.port}`, (err as Error).message);
      }
    }
    return this.browserInstance;
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
    const browser = await this.getBrowser();
    const contexts = browser.contexts();
    const pages = contexts.flatMap((c) => c.pages());
    const descriptors: TabDescriptor[] = [];

    this.pageMap.clear();
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i]!;
      const url = p.url();
      if (url.startsWith("chrome://") || url.startsWith("chrome-extension://")) continue;
      const targetId = `pw-tab-${i}-${Buffer.from(url).toString("base64url").slice(0, 10)}`;
      this.pageMap.set(targetId, p);
      let title = "Page";
      try { title = await p.title(); } catch {}
      descriptors.push({ targetId, url, title });
    }
    return descriptors;
  }

  public async attach(targetId: string): Promise<SessionHandle> {
    if (!this.pageMap.has(targetId)) await this.listTabs();
    const page = this.pageMap.get(targetId);
    if (!page) throw new TabNotFoundError(undefined, targetId);

    return { sessionId: `pw-session-${targetId}-${Date.now()}`, targetId, adapterId: this.id };
  }

  public async detach(_handle: SessionHandle): Promise<void> {}

  public async keepAliveInBackground(handle: SessionHandle): Promise<void> {
    const page = this.pageMap.get(handle.targetId);
    if (!page) return;
    try {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
      await cdp.send("Page.setWebLifecycleState", { state: "active" });
    } catch {}
  }

  public async bringToFront(handle: SessionHandle): Promise<void> {
    const page = this.pageMap.get(handle.targetId);
    if (page) await page.bringToFront();
  }

  public async evaluate<T>(handle: SessionHandle, expression: string): Promise<T> {
    const page = this.pageMap.get(handle.targetId);
    if (!page) throw new TabNotFoundError(undefined, handle.targetId);
    return page.evaluate(expression) as Promise<T>;
  }

  public async fillText(handle: SessionHandle, selector: string, text: string): Promise<void> {
    const page = this.pageMap.get(handle.targetId);
    if (!page) throw new TabNotFoundError(undefined, handle.targetId);
    await page.fill(selector, text);
  }

  public async click(handle: SessionHandle, selector: string): Promise<void> {
    const page = this.pageMap.get(handle.targetId);
    if (!page) throw new TabNotFoundError(undefined, handle.targetId);
    await page.click(selector);
  }

  public async pressKey(handle: SessionHandle, selector: string, key: string): Promise<void> {
    const page = this.pageMap.get(handle.targetId);
    if (!page) throw new TabNotFoundError(undefined, handle.targetId);
    await page.press(selector, key);
  }

  public async setInputFiles(handle: SessionHandle, selector: string, filePaths: string[]): Promise<void> {
    const page = this.pageMap.get(handle.targetId);
    if (!page) throw new TabNotFoundError(undefined, handle.targetId);
    await page.setInputFiles(selector, filePaths);
  }

  public async createTab(url: string): Promise<TabDescriptor> {
    const browser = await this.getBrowser();
    const context = browser.contexts()[0] ?? await browser.newContext();
    const page = await context.newPage();
    await page.goto(url);
    const targetId = `pw-tab-${Date.now()}`;
    this.pageMap.set(targetId, page);
    return { targetId, url: page.url(), title: await page.title() };
  }

  public async closeTab(targetId: string): Promise<void> {
    const page = this.pageMap.get(targetId);
    if (page) {
      await page.close();
      this.pageMap.delete(targetId);
    }
  }

  public async navigate(handle: SessionHandle, url: string): Promise<void> {
    const page = this.pageMap.get(handle.targetId);
    if (page) await page.goto(url);
  }

  public async goBack(handle: SessionHandle): Promise<void> {
    const page = this.pageMap.get(handle.targetId);
    if (page) await page.goBack();
  }
}
