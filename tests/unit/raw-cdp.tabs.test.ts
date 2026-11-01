import { describe, expect, it } from "bun:test";
import { RawCdpAdapter } from "../../src/adapters/browsers/raw-cdp.adapter.js";
import type { SessionHandle } from "../../src/core/ports/browser.port.js";

describe("RawCdpAdapter Tab & Navigation Operations", () => {
  it("creates a tab by issuing HTTP PUT to /json/new", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";
    let requestedMethod = "";

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requestedUrl = String(input);
      requestedMethod = init?.method ?? "GET";
      return new Response(
        JSON.stringify({
          id: "tab-new-123",
          url: "https://chatgpt.com/",
          title: "ChatGPT",
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/tab-new-123",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as any;

    try {
      const adapter = new RawCdpAdapter(9222);
      const tab = await adapter.createTab("https://chatgpt.com/");

      expect(requestedMethod).toBe("PUT");
      expect(requestedUrl).toContain("/json/new?https%3A%2F%2Fchatgpt.com%2F");
      expect(tab.targetId).toBe("tab-new-123");
      expect(tab.url).toBe("https://chatgpt.com/");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("closes a tab by issuing HTTP to /json/close", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl = "";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response("Target is closing", { status: 200 });
    }) as any;

    try {
      const adapter = new RawCdpAdapter(9222);
      await adapter.closeTab("tab-new-123");

      expect(requestedUrl).toContain("/json/close/tab-new-123");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("navigates and goes back via evaluate", async () => {
    const adapter = new RawCdpAdapter(9222);
    const handle: SessionHandle = { sessionId: "s1", targetId: "t1", adapterId: "raw-cdp" };
    const evaluated: string[] = [];

    // Mock evaluate on adapter
    adapter.evaluate = async (_handle: SessionHandle, expr: string) => {
      evaluated.push(expr);
      return undefined as any;
    };

    await adapter.navigate(handle, "https://chat.deepseek.com/");
    await adapter.goBack(handle);

    expect(evaluated.some((e) => e.includes("window.location.href =") && e.includes("chat.deepseek.com"))).toBe(true);
    expect(evaluated.some((e) => e.includes("window.history.back()"))).toBe(true);
  });

  it("resolves WSL2 gateway endpoint and rewrites wsDebuggerUrl when 127.0.0.1 fails in WSL", async () => {
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("127.0.0.1")) {
        throw new Error("Connection refused on loopback");
      }
      if (url.includes("172.28.0.1")) {
        return new Response(
          JSON.stringify([
            {
              id: "tab-wsl-1",
              type: "page",
              url: "https://chatgpt.com/",
              title: "ChatGPT",
              webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/tab-wsl-1",
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Unexpected URL: ${url}`);
    }) as any;

    try {
      const adapter = new RawCdpAdapter(9222, {
        isWsl: () => true,
        getWslGateway: () => "172.28.0.1",
      });

      const tabs = await adapter.listTabs();

      expect(requestedUrls.some((u) => u.includes("127.0.0.1"))).toBe(true);
      expect(requestedUrls.some((u) => u.includes("172.28.0.1"))).toBe(true);
      expect(tabs.length).toBe(1);
      expect(tabs[0]?.webSocketDebuggerUrl).toBe("ws://172.28.0.1:9222/devtools/page/tab-wsl-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
