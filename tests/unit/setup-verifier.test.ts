import { describe, expect, it } from "bun:test";
import { verifySetup } from "../../src/adapters/browsers/setup-verifier.js";
import type { BrowserPort, SessionHandle, TabDescriptor, TransportHealth } from "../../src/core/ports/browser.port.js";
import type { ResolvedSetup } from "../../src/core/services/setup/precedence.js";

class FakeBrowser implements BrowserPort {
  public readonly id = "firefox-bidi" as const;
  public created: string[] = [];
  public closed: string[] = [];
  public detached = 0;
  public disconnected = 0;

  constructor(
    private readonly healthy: boolean,
    private readonly pageReady = true,
  ) {}

  async health(): Promise<TransportHealth> {
    return { ok: this.healthy, adapterId: this.id, endpoint: "http://127.0.0.1:9223", openTabsCount: 0, latencyMs: 1 };
  }
  async listTabs(): Promise<TabDescriptor[]> { return []; }
  async attach(targetId: string): Promise<SessionHandle> { return { sessionId: "s", targetId, adapterId: this.id }; }
  async detach(): Promise<void> { this.detached += 1; }
  async keepAliveInBackground(): Promise<void> {}
  async bringToFront(): Promise<void> {}
  async evaluate<T>(): Promise<T> { return this.pageReady as T; }
  async fillText(): Promise<void> {}
  async click(): Promise<void> {}
  async pressKey(): Promise<void> {}
  async setInputFiles(): Promise<void> {}
  async createTab(url: string): Promise<TabDescriptor> {
    this.created.push(url);
    return { targetId: "t1", url, title: "new" };
  }
  async closeTab(targetId: string): Promise<void> { this.closed.push(targetId); }
  async disconnect(): Promise<void> { this.disconnected += 1; }
}

const resolution: ResolvedSetup = {
  browserId: "firefox",
  profilePath: "/home/u/.mozilla/firefox/rel",
  transport: "firefox-bidi",
  port: 9223,
  endpoint: "http://127.0.0.1:9223",
  sources: { browserId: "project", profileId: "derived", profilePath: "project", transport: "derived", port: "derived" },
};

describe("setup verification", () => {
  it("verifies the transport and reports success", async () => {
    const browser = new FakeBrowser(true);
    const result = await verifySetup(resolution, { factory: () => browser, pageProbe: false });

    expect(result.ok).toBe(true);
    expect(result.transportOk).toBe(true);
    expect(browser.disconnected).toBe(1);
  });

  it("fails with browser-unreachable and performs no tab work", async () => {
    const browser = new FakeBrowser(false);
    const result = await verifySetup(resolution, { factory: () => browser, pageProbe: true });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("browser-unreachable");
    expect(browser.created).toHaveLength(0);
  });

  it("opens and closes exactly its own tab for the page probe", async () => {
    const browser = new FakeBrowser(true, true);
    const result = await verifySetup(resolution, {
      factory: () => browser,
      pageProbe: true,
      platform: "deepseek",
    });

    expect(result.ok).toBe(true);
    expect(result.pageOk).toBe(true);
    expect(browser.created).toHaveLength(1);
    expect(browser.closed).toEqual(["t1"]);
  });

  it("keeps the transport result when the page probe fails", async () => {
    const browser = new FakeBrowser(true, false);
    const result = await verifySetup(resolution, { factory: () => browser, pageProbe: true, platform: "gemini" });

    expect(result.ok).toBe(true);
    expect(result.pageOk).toBe(false);
    expect(result.warning).toContain("gemini");
    expect(browser.closed).toEqual(["t1"]);
  });

  it("refuses a default Chromium profile before opening a socket", async () => {
    let factoryCalled = false;
    const result = await verifySetup(
      { ...resolution, browserId: "chrome", profilePath: "/home/u/.config/google-chrome", transport: "raw-cdp", port: 9222 },
      {
        factory: () => { factoryCalled = true; return new FakeBrowser(true); },
        defaultProfilePath: "/home/u/.config/google-chrome",
      },
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("default-profile-blocked");
    expect(factoryCalled).toBe(false);
  });
});
