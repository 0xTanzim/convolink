import { describe, expect, it } from "bun:test";
import { FirefoxBidiAdapter } from "../../src/adapters/browsers/firefox-bidi.adapter.js";

async function isBidiAvailable(port = 9223): Promise<boolean> {
  try {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        resolve(false);
      }, 500);
      ws.onopen = () => {
        clearTimeout(timer);
        try { ws.close(); } catch {}
        resolve(true);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
    });
  } catch {
    return false;
  }
}

const bidiAvailable = await isBidiAvailable(9223);

describe.skipIf(!bidiAvailable)("FirefoxBidiAdapter Integration (Port 9223)", () => {
  const adapter = new FirefoxBidiAdapter(9223);

  it("queries transport health against running Firefox instance", async () => {
    const health = await adapter.health();

    expect(health.ok).toBe(true);
    expect(health.adapterId).toBe("firefox-bidi");
    expect(health.capabilities?.protocol).toBe("webdriver-bidi");
    expect(health.capabilities?.browserFamily).toBe("firefox");
    expect(health.openTabsCount).toBeGreaterThan(0);
  });

  it("lists open tabs with canonical targetId and url", async () => {
    const tabs = await adapter.listTabs();

    expect(tabs.length).toBeGreaterThan(0);
    const first = tabs[0];
    expect(typeof first?.targetId).toBe("string");
    expect(typeof first?.url).toBe("string");
  });

  it("creates a tab, attaches, evaluates JavaScript, and closes cleanly", async () => {
    const tab = await adapter.createTab("about:blank");

    expect(typeof tab.targetId).toBe("string");
    const handle = await adapter.attach(tab.targetId);
    expect(handle.targetId).toBe(tab.targetId);
    expect(handle.adapterId).toBe("firefox-bidi");

    const mathResult = await adapter.evaluate<number>(handle, "40 + 2");
    expect(mathResult).toBe(42);

    const titleResult = await adapter.evaluate<string>(handle, "document.title || 'Blank Tab'");
    expect(typeof titleResult).toBe("string");

    await adapter.detach(handle);
    await adapter.closeTab(tab.targetId);
  });

  it("executes human click on an element without throwing", async () => {
    const tab = await adapter.createTab("about:blank");
    const handle = await adapter.attach(tab.targetId);

    await adapter.evaluate(handle, `(() => {
      const btn = document.createElement('button');
      btn.id = 'test-btn';
      btn.textContent = 'Click Me';
      document.body.appendChild(btn);
    })()`);

    await adapter.click(handle, "#test-btn");

    await adapter.detach(handle);
    await adapter.closeTab(tab.targetId);
  }, 10000);
});
