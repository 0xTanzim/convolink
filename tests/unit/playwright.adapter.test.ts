import { describe, expect, it } from "bun:test";
import { PlaywrightAdapter } from "../../src/adapters/browsers/playwright.adapter.js";
import type { SessionHandle } from "../../src/core/ports/browser.port.js";

describe("PlaywrightAdapter", () => {
  const fakePage = {
    url: () => "https://chatgpt.com/c/123",
    title: async () => "ChatGPT Session",
    evaluate: async (expr: string) => ({ evalResult: 42 }),
    fill: async (_sel: string, _txt: string) => {},
    click: async (_sel: string) => {},
    press: async (_sel: string, _key: string) => {},
    setInputFiles: async (_sel: string, _files: string[]) => {},
    bringToFront: async () => {},
    close: async () => {},
    goto: async (_url: string) => {},
    goBack: async () => {},
    context: () => ({
      newCDPSession: async () => ({ send: async () => {} }),
    }),
  };

  const fakeBrowser = {
    contexts: () => [
      {
        pages: () => [fakePage],
        newPage: async () => fakePage,
      },
    ],
    isConnected: () => true,
    close: async () => {},
  };

  const fakeConnect = async (_endpoint: string) => fakeBrowser as any;

  it("reports adapter id as playwright and capabilities", () => {
    const adapter = new PlaywrightAdapter(9222, fakeConnect);
    expect(adapter.id).toBe("playwright");
    expect(adapter.capabilities.protocol).toBe("cdp");
    expect(adapter.capabilities.supportsTabManagement).toBe(true);
  });

  it("lists open tabs from Playwright context pages", async () => {
    const adapter = new PlaywrightAdapter(9222, fakeConnect);
    const tabs = await adapter.listTabs();

    expect(tabs.length).toBe(1);
    expect(tabs[0]?.url).toBe("https://chatgpt.com/c/123");
    expect(tabs[0]?.title).toBe("ChatGPT Session");
  });

  it("attaches to target tab and evaluates expression", async () => {
    const adapter = new PlaywrightAdapter(9222, fakeConnect);
    const tabs = await adapter.listTabs();
    const targetId = tabs[0]!.targetId;

    const handle = await adapter.attach(targetId);
    expect(handle.targetId).toBe(targetId);
    expect(handle.adapterId).toBe("playwright");

    const result = await adapter.evaluate<{ evalResult: number }>(handle, "() => 42");
    expect(result.evalResult).toBe(42);

    await adapter.detach(handle);
  });

  it("sets input files using Playwright native file handling", async () => {
    const adapter = new PlaywrightAdapter(9222, fakeConnect);
    const tabs = await adapter.listTabs();
    const handle = await adapter.attach(tabs[0]!.targetId);

    let called = false;
    fakePage.setInputFiles = async () => {
      called = true;
    };

    await adapter.setInputFiles(handle, 'input[type="file"]', ["/tmp/test.ts"]);
    expect(called).toBe(true);
  });
});
