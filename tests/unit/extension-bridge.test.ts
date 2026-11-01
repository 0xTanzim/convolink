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

  it("handles multi-client registration and aggregates tabs across browsers", async () => {
    adapter = new ExtensionBridgeAdapter(19227);
    await adapter.start();

    // Connect Client 1 (Chrome)
    const wsChrome = new WebSocket("ws://127.0.0.1:19227");
    await new Promise<void>((r) => { wsChrome.onopen = () => r(); });
    wsChrome.send(JSON.stringify({
      type: "HANDSHAKE",
      protocolVersion: 1,
      clientId: "client-chrome",
      installationProfileId: "prof-chrome",
      connectionId: "conn-c1",
      browserFamily: "chrome",
      profileLabel: "Work",
      extensionVersion: "1.0.0",
    }));

    // Connect Client 2 (Brave)
    const wsBrave = new WebSocket("ws://127.0.0.1:19227");
    await new Promise<void>((r) => { wsBrave.onopen = () => r(); });
    wsBrave.send(JSON.stringify({
      type: "HANDSHAKE",
      protocolVersion: 1,
      clientId: "client-brave",
      installationProfileId: "prof-brave",
      connectionId: "conn-b1",
      browserFamily: "brave",
      profileLabel: "Creative",
      extensionVersion: "1.0.0",
    }));

    wsChrome.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.type === "LIST_TABS") {
        wsChrome.send(JSON.stringify({
          id: msg.id,
          result: [{ tabId: 101, title: "ChatGPT Work", url: "https://chatgpt.com/" }],
        }));
      }
    };

    wsBrave.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.type === "LIST_TABS") {
        wsBrave.send(JSON.stringify({
          id: msg.id,
          result: [{ tabId: 202, title: "DeepSeek Creative", url: "https://chat.deepseek.com/" }],
        }));
      }
    };

    await new Promise((r) => setTimeout(r, 60));

    const clients = adapter.getConnectedClients();
    expect(clients.length).toBe(2);

    const tabs = await adapter.listTabs();
    expect(tabs.length).toBe(2);
    expect(tabs.some((t) => t.title.includes("ChatGPT Work"))).toBe(true);
    expect(tabs.some((t) => t.title.includes("DeepSeek Creative"))).toBe(true);

    wsChrome.close();
    wsBrave.close();
  });

  it("socket-guarded close: closing an old socket does not delete a newly registered client", async () => {
    adapter = new ExtensionBridgeAdapter(19228);
    await adapter.start();

    // Connection 1 (Old)
    const wsOld = new WebSocket("ws://127.0.0.1:19228");
    await new Promise<void>((r) => { wsOld.onopen = () => r(); });
    wsOld.send(JSON.stringify({
      type: "HANDSHAKE",
      protocolVersion: 1,
      clientId: "client-persisted",
      installationProfileId: "prof-persisted",
      connectionId: "conn-old",
      browserFamily: "chrome",
      profileLabel: "Personal",
      extensionVersion: "1.0.0",
    }));

    await new Promise((r) => setTimeout(r, 40));

    // Connection 2 (New, replacing old for same installationProfileId)
    const wsNew = new WebSocket("ws://127.0.0.1:19228");
    await new Promise<void>((r) => { wsNew.onopen = () => r(); });
    wsNew.send(JSON.stringify({
      type: "HANDSHAKE",
      protocolVersion: 1,
      clientId: "client-persisted",
      installationProfileId: "prof-persisted",
      connectionId: "conn-new",
      browserFamily: "chrome",
      profileLabel: "Personal",
      extensionVersion: "1.0.0",
    }));

    await new Promise((r) => setTimeout(r, 40));

    // Now close the OLD socket. The client must REMAIN in registry via wsNew!
    wsOld.close();
    await new Promise((r) => setTimeout(r, 40));

    const clients = adapter.getConnectedClients();
    expect(clients.length).toBe(1);
    expect(clients[0]?.connectionId).toBe("conn-new");

    wsNew.close();
  });
});
