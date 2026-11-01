import { describe, expect, it, afterEach } from "bun:test";
import { ExtensionBridgeAdapter } from "../../src/adapters/browsers/extension-bridge.adapter.js";

describe("ExtensionBridgeAdapter", () => {
  let adapter: ExtensionBridgeAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.stop();
      adapter = null;
    }
  });

  it("reports adapter id as extension-bridge with correct capabilities", () => {
    adapter = new ExtensionBridgeAdapter(19224);
    expect(adapter.id).toBe("extension-bridge");
    expect(adapter.capabilities.protocol).toBe("cdp");
    expect(adapter.capabilities.browserFamily).toBe("chromium");
  });

  it("reports offline health when no extension client is connected", async () => {
    adapter = new ExtensionBridgeAdapter(19225);
    const health = await adapter.health();
    expect(health.ok).toBe(false);
    expect(health.adapterId).toBe("extension-bridge");
    expect(health.error).toContain("No ConvoLink Chrome Companion extension connected");
  });

  it("handles extension registration and responds to listTabs", async () => {
    adapter = new ExtensionBridgeAdapter(19226);
    await adapter.start();

    // Simulate extension WebSocket connecting
    const ws = new WebSocket("ws://127.0.0.1:19226");
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    // Mock extension sending handshake
    ws.send(JSON.stringify({ type: "HANDSHAKE", extensionVersion: "1.0.0", profileName: "Everyday Chrome" }));

    // Mock extension responding to LIST_TABS
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.type === "LIST_TABS") {
        ws.send(
          JSON.stringify({
            id: msg.id,
            result: [
              { targetId: "ext-tab-1", title: "ChatGPT Everyday", url: "https://chatgpt.com/c/real-1" },
            ],
          }),
        );
      }
    };

    // Wait for handshake
    await new Promise((r) => setTimeout(r, 50));

    const health = await adapter.health();
    expect(health.ok).toBe(true);

    const tabs = await adapter.listTabs();
    expect(tabs.length).toBe(1);
    expect(tabs[0]?.targetId).toBe("ext-tab-1");
    expect(tabs[0]?.title).toBe("ChatGPT Everyday");

    ws.close();
  });
});
