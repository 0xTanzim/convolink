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
    expect(health.error).toContain("No ConvoLink Companion extension connected");
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

  it("rejects untrusted origin headers like public websites", async () => {
    adapter = new ExtensionBridgeAdapter(19229);
    await adapter.start();

    // Try connecting with a malicious website origin header
    const res = await fetch("http://127.0.0.1:19229", {
      headers: {
        Origin: "https://evil-attacker.example.com",
      },
    });
    expect(res.status).toBe(403);
  });

  it("authenticates handshake with valid pairing token and rejects invalid token", async () => {
    const fakeTokenService = {
      getToken: () => "valid-secret-token-1234567890abcdef",
      validateToken: (t?: string) => t === "valid-secret-token-1234567890abcdef",
      rotateToken: () => "new-token",
    };

    adapter = new ExtensionBridgeAdapter(19230, fakeTokenService as any);
    await adapter.start();

    // 1. Connection with invalid token
    const wsBad = new WebSocket("ws://127.0.0.1:19230");
    await new Promise<void>((r) => { wsBad.onopen = () => r(); });

    let badAck: any = null;
    wsBad.onmessage = (e) => {
      badAck = JSON.parse(e.data.toString());
    };

    wsBad.send(JSON.stringify({
      type: "HANDSHAKE",
      protocolVersion: 1,
      clientId: "client-bad",
      token: "wrong-token",
    }));

    await new Promise((r) => setTimeout(r, 50));
    expect(badAck?.success).toBe(false);
    expect(badAck?.error).toContain("Invalid pairing token");
    expect(adapter.getConnectedClients().length).toBe(0);

    // 2. Connection with valid token
    const wsGood = new WebSocket("ws://127.0.0.1:19230");
    await new Promise<void>((r) => { wsGood.onopen = () => r(); });

    let goodAck: any = null;
    wsGood.onmessage = (e) => {
      goodAck = JSON.parse(e.data.toString());
    };

    wsGood.send(JSON.stringify({
      type: "HANDSHAKE",
      protocolVersion: 1,
      clientId: "client-good",
      token: "valid-secret-token-1234567890abcdef",
    }));

    await new Promise((r) => setTimeout(r, 50));
    expect(goodAck?.success).toBe(true);
    expect(adapter.getConnectedClients().length).toBe(1);

    wsGood.close();
  });

  it("routes evaluate, fillText, click, and pressKey DOM actions to connected extension", async () => {
    adapter = new ExtensionBridgeAdapter(19231);
    await adapter.start();

    const ws = new WebSocket("ws://127.0.0.1:19231");
    await new Promise<void>((r) => { ws.onopen = () => r(); });

    const receivedActions: any[] = [];
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data.toString());
      receivedActions.push(msg);
      if (msg.type === "LIST_TABS") {
        ws.send(JSON.stringify({ id: msg.id, result: [{ tabId: 777, title: "AI Tab", url: "https://chatgpt.com/" }] }));
      } else if (msg.type === "EVALUATE") {
        ws.send(JSON.stringify({ id: msg.id, result: { value: 42 } }));
      } else if (["ATTACH", "FILL_TEXT", "CLICK", "PRESS_KEY"].includes(msg.type)) {
        ws.send(JSON.stringify({ id: msg.id, result: { ok: true } }));
      }
    };

    ws.send(JSON.stringify({
      type: "HANDSHAKE",
      protocolVersion: 1,
      clientId: "client-777",
      browserFamily: "chrome",
    }));
    await new Promise((r) => setTimeout(r, 40));

    const tabs = await adapter.listTabs();
    expect(tabs.length).toBe(1);

    const session = await adapter.attach("777");
    expect(session.targetId).toBe("777");

    const evalRes = await adapter.evaluate<number>(session, "1 + 41");
    expect(evalRes).toBe(42);

    await adapter.fillText(session, "textarea#prompt", "Hello AI");
    await adapter.click(session, "button#send");
    await adapter.pressKey(session, "textarea#prompt", "Enter");

    expect(receivedActions.some((a) => a.type === "EVALUATE" && a.expression === "1 + 41")).toBe(true);
    expect(receivedActions.some((a) => a.type === "FILL_TEXT" && a.text === "Hello AI")).toBe(true);
    expect(receivedActions.some((a) => a.type === "CLICK" && a.selector === "button#send")).toBe(true);
    expect(receivedActions.some((a) => a.type === "PRESS_KEY" && a.key === "Enter")).toBe(true);

    ws.close();
  });
});
