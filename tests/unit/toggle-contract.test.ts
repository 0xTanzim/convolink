import { afterEach, describe, expect, it } from "bun:test";
import { ExtensionBridgeAdapter } from "../../src/adapters/browsers/extension-bridge.adapter.js";

/**
 * DeepThink/Search toggles used to travel as arbitrary JavaScript, which the
 * extension refuses (MV3 CSP). The contract comment is the transport-safe
 * equivalent, so a regression here silently disables `--think`.
 */
describe("toggle contract translation", () => {
  let adapter: ExtensionBridgeAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.stop();
      adapter = null;
    }
  });

  it("maps a convolink:toggles contract to APPLY_TOGGLES", async () => {
    adapter = new ExtensionBridgeAdapter(19245);
    await adapter.start();

    const ws = new WebSocket("ws://127.0.0.1:19245");
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });

    const received: Array<Record<string, any>> = [];
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (typeof msg.type !== "string") return;
      received.push(msg);
      if (msg.type === "LIST_TABS") {
        ws.send(JSON.stringify({ v: 2, id: msg.id, ok: true, result: [{ tabId: 5, title: "DS", url: "https://chat.deepseek.com/" }] }));
        return;
      }
      ws.send(JSON.stringify({ v: 2, id: msg.id, ok: true, result: { ok: true, applied: ["think"] } }));
    };

    ws.send(JSON.stringify({ type: "HANDSHAKE", protocolVersion: 2, clientId: "client-toggle", browserFamily: "chrome" }));
    await new Promise((resolve) => setTimeout(resolve, 40));

    const session = await adapter.attach("5");
    const contract = JSON.stringify({
      selector: ".ds-toggle-button",
      selectedClass: "ds-toggle-button--selected",
      toggles: { think: { label: "DeepThink", selected: true } },
    });
    await adapter.evaluate(session, `(() => { /* convolink:toggles ${contract} */ })()`);

    const applied = received.find((msg) => msg.type === "APPLY_TOGGLES");
    expect(applied).toBeDefined();
    expect(applied?.selector).toBe(".ds-toggle-button");
    expect(applied?.selectedClass).toBe("ds-toggle-button--selected");
    expect(applied?.toggles?.think).toEqual({ label: "DeepThink", selected: true });

    ws.close();
  });
});
