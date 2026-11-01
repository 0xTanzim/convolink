import type {
  BrowserPort,
  SessionHandle,
  TabDescriptor,
  TransportHealth,
} from "../../src/core/ports/browser.port.js";

export class FakeBrowserPort implements BrowserPort {
  public readonly id = "raw-cdp" as const;
  public evaluatedExpressions: string[] = [];
  public evalResponseMap = new Map<string, unknown>();
  public filledTexts: Array<{ selector: string; text: string }> = [];
  public clickedSelectors: string[] = [];
  public customTabs?: TabDescriptor[];

  public async health(): Promise<TransportHealth> {
    return { ok: true, adapterId: "fake", endpoint: "fake", openTabsCount: 1, latencyMs: 1 };
  }

  public async listTabs(): Promise<TabDescriptor[]> {
    if (this.customTabs) return this.customTabs;
    return [{ targetId: "tab-1", title: "DeepSeek", url: "https://chat.deepseek.com/a/chat/s/test-123" }];
  }

  public async attach(targetId: string): Promise<SessionHandle> {
    return { sessionId: "s1", targetId, adapterId: "raw-cdp" };
  }

  public async detach(_handle: SessionHandle): Promise<void> {}
  public async keepAliveInBackground(_handle: SessionHandle): Promise<void> {}
  public async bringToFront(_handle: SessionHandle): Promise<void> {}

  public async evaluate<T>(_handle: SessionHandle, expression: string): Promise<T> {
    this.evaluatedExpressions.push(expression);
    for (const [key, value] of this.evalResponseMap.entries()) {
      if (expression.includes(key)) {
        return value as T;
      }
    }
    return {} as T;
  }

  public async fillText(_handle: SessionHandle, selector: string, text: string): Promise<void> {
    this.filledTexts.push({ selector, text });
  }

  public async click(_handle: SessionHandle, selector: string): Promise<void> {
    this.clickedSelectors.push(selector);
  }

  public async pressKey(_handle: SessionHandle, _selector: string, _key: string): Promise<void> {}
  public async setInputFiles(_handle: SessionHandle, _selector: string, _filePaths: string[]): Promise<void> {}

  public createdTabs: string[] = [];
  public closedTabs: string[] = [];
  public navigatedUrls: Array<{ handle: SessionHandle; url: string }> = [];
  public backNavigations: SessionHandle[] = [];

  public async createTab(url: string): Promise<TabDescriptor> {
    this.createdTabs.push(url);
    const targetId = `tab-spawned-${this.createdTabs.length}`;
    return { targetId, url, title: `Tab for ${url}` };
  }

  public async closeTab(targetId: string): Promise<void> {
    this.closedTabs.push(targetId);
  }

  public async navigate(handle: SessionHandle, url: string): Promise<void> {
    this.navigatedUrls.push({ handle, url });
  }

  public async goBack(handle: SessionHandle): Promise<void> {
    this.backNavigations.push(handle);
  }
}
