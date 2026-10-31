import { describe, expect, it } from "bun:test";
import { RawCdpAdapter } from "../../src/adapters/browsers/raw-cdp.adapter.js";

async function isCdpAvailable(port = 9222): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const cdpAvailable = await isCdpAvailable(9222);

describe.skipIf(!cdpAvailable)("RawCdpAdapter Integration (Port 9222)", () => {
  it("queries transport health against running Chrome instance", async () => {
    const adapter = new RawCdpAdapter(9222);
    const health = await adapter.health();

    expect(health.ok).toBe(true);
    expect(health.adapterId).toBe("raw-cdp");
    expect(health.openTabsCount).toBeGreaterThan(0);
  });

  it("lists open tabs with canonical targetId and url", async () => {
    const adapter = new RawCdpAdapter(9222);
    const tabs = await adapter.listTabs();

    expect(tabs.length).toBeGreaterThan(0);
    const first = tabs[0];
    expect(typeof first?.targetId).toBe("string");
    expect(typeof first?.url).toBe("string");
  });

  it("attaches to an open tab, evaluates an expression, and detaches cleanly", async () => {
    const adapter = new RawCdpAdapter(9222);
    const tabs = await adapter.listTabs();
    const target = tabs.find((t) => t.url.includes("deepseek") || t.url.includes("chatgpt") || t.url.includes("gemini")) || tabs[0];
    if (!target) return;

    const handle = await adapter.attach(target.targetId);
    expect(handle.targetId).toBe(target.targetId);
    expect(handle.adapterId).toBe("raw-cdp");

    const sum = await adapter.evaluate<number>(handle, "15 + 27");
    expect(sum).toBe(42);

    await adapter.detach(handle);
  });
});
