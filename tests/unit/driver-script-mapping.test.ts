import { afterEach, describe, expect, it } from "bun:test";
import { ExtensionBridgeAdapter } from "../../src/adapters/browsers/extension-bridge.adapter.js";

/**
 * The Claude ask path evaluates three driver scripts that the transport cannot
 * run verbatim: the auth check, the turn fingerprint, and the continuation
 * probe. Two of them were previously swallowed by `.catch()`, which turned a
 * missing mapping into a silent timeout. These assertions pin the mappings.
 */
describe("driver script mappings", () => {
  let adapter: ExtensionBridgeAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.stop();
      adapter = null;
    }
  });

  async function connect(port: number, composerMounted: boolean) {
    adapter = new ExtensionBridgeAdapter(port);
    await adapter.start();
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });
    const seen: string[] = [];
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (typeof msg.type !== "string") return;
      seen.push(msg.type);
      const reply = (result: unknown) => ws.send(JSON.stringify({ v: 2, id: msg.id, ok: true, result }));
      if (msg.type === "LIST_TABS") return reply([{ tabId: 7, title: "AI", url: "https://claude.ai/chat/1" }]);
      if (msg.type === "PROBE_MOUNTED") return reply(composerMounted);
      if (msg.type === "PROBE_CONTINUATION") return reply({ hasContinuation: false });
      return reply({ ok: true });
    };
    ws.send(JSON.stringify({ type: "HANDSHAKE", protocolVersion: 2, clientId: "mapper", browserFamily: "chrome" }));
    await new Promise((resolve) => setTimeout(resolve, 40));
    const session = await adapter.attach("7");
    return { session, seen, close: () => ws.close() };
  }

  it("answers the auth check from composer presence, inverted to the driver convention", async () => {
    const mounted = await connect(19247, true);
    const noWall = await adapter!.evaluate<boolean>(mounted.session, `(() => {
      /* authCheck */
      /* convolink:selectors {"composer": "div[contenteditable='true']"} */
      return Boolean(login && !document.querySelector('div[contenteditable="true"]'));
    })()`);
    expect(noWall).toBe(false);
    expect(mounted.seen).toContain("PROBE_MOUNTED");
    mounted.close();
    await adapter!.stop();

    const unmounted = await connect(19248, false);
    const wall = await adapter!.evaluate<boolean>(unmounted.session, `(() => {
      /* authCheck */
      /* convolink:selectors {"composer": "div[contenteditable='true']"} */
      return Boolean(login && !document.querySelector('div[contenteditable="true"]'));
    })()`);
    expect(wall).toBe(true);
    unmounted.close();
  });

  it("maps the continuation probe and trigger instead of evaluating them", async () => {
    const fake = await connect(19249, true);

    const probe = await adapter!.evaluate<{ hasContinuation: boolean }>(fake.session, `(() => {
      /* findContinuationTrigger */
      return { hasContinuation: true, triggerSelector: "button" };
    })()`);
    expect(probe.hasContinuation).toBe(false);

    await adapter!.evaluate(fake.session, `(() => {
      /* triggerContinuation */
      button.click();
    })()`);
    expect(fake.seen).toContain("PROBE_CONTINUATION");
    expect(fake.seen).toContain("TRIGGER_CONTINUATION");
    fake.close();
  });
});
