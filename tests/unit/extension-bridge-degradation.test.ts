import { afterEach, describe, expect, it } from "bun:test";
import { ExtensionBridgeAdapter } from "../../src/adapters/browsers/extension-bridge.adapter.js";

/**
 * Assertions capture the rejection explicitly: Bun's `expect().rejects`
 * resolves as soon as the promise settles, so the afterEach teardown can close
 * the bridge before a later fallback request runs and mask the real error.
 */

interface FakeExtension {
  readonly seen: string[];
  close(): void;
}

interface FakeHandlers {
  readonly trustedFill: (id: number, send: (body: unknown) => void) => void;
  readonly composerText: () => boolean;
  readonly domFill: (text: string) => { ok: boolean; error?: string };
  readonly getText?: () => string;
}

async function startFakeExtension(port: number, clientId: string, handlers: FakeHandlers): Promise<FakeExtension> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve) => {
    ws.onopen = () => resolve();
  });

  const seen: string[] = [];
  const send = (body: unknown) => ws.send(JSON.stringify(body));

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data.toString());
    if (typeof msg.type !== "string") return;
    seen.push(msg.type);
    const reply = (result: unknown) => send({ v: 2, id: msg.id, ok: true, result });

    if (msg.type === "LIST_TABS") return reply([{ tabId: 888, title: "AI", url: "https://chatgpt.com/" }]);
    if (msg.type === "PROBE_COMPOSER_TEXT") return reply(handlers.composerText());
    if (msg.type === "FILL_TEXT" && msg.text) return reply(handlers.domFill(String(msg.text)));
    if (msg.type === "TRUSTED_FILL") return handlers.trustedFill(msg.id, send);
    if (msg.type === "GET_TEXT") return reply(handlers.getText?.() ?? "");
    return reply({ ok: true });
  };

  ws.send(JSON.stringify({ type: "HANDSHAKE", protocolVersion: 2, clientId, browserFamily: "chrome" }));
  await new Promise((resolve) => setTimeout(resolve, 40));

  return { seen, close: () => ws.close() };
}

async function rejectionOf(run: () => Promise<unknown>): Promise<{ code?: string; message?: string } | null> {
  try {
    await run();
    return null;
  } catch (error) {
    return error as { code?: string; message?: string };
  }
}

describe("ExtensionBridgeAdapter trusted-input degradation", () => {
  let adapter: ExtensionBridgeAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.stop();
      adapter = null;
    }
  });

  it("falls back to DOM injection when trusted input is unavailable and surfaces the failure", async () => {
    adapter = new ExtensionBridgeAdapter(19242);
    await adapter.start();

    const fake = await startFakeExtension(19242, "client-888", {
      trustedFill: (id, send) =>
        send({ v: 2, id, ok: false, error: { code: "unsupported", message: "TRUSTED_FILL unavailable" } }),
      composerText: () => false,
      domFill: () => ({ ok: false, error: "editor rejected the DOM injection" }),
    });

    const session = await adapter.attach("888");
    const error = await rejectionOf(() => adapter!.fillText(session, "#prompt-textarea", "probe"));

    expect(error?.code).toBe("not-ready");
    expect(error?.message).toContain("editor rejected");
    expect(fake.seen).toContain("TRUSTED_FILL");
    expect(fake.seen).toContain("FOCUS");
    expect(fake.seen).toContain("TRUSTED_TYPE");
    expect(fake.seen.filter((type) => type === "FILL_TEXT").length).toBe(2);
    fake.close();
  });

  it("accepts the trusted fill without a DOM fallback when the composer verifies", async () => {
    adapter = new ExtensionBridgeAdapter(19243);
    await adapter.start();

    const fake = await startFakeExtension(19243, "client-999", {
      trustedFill: (id, send) => send({ v: 2, id, ok: true, result: { ok: true, trusted: true } }),
      composerText: () => true,
      domFill: () => ({ ok: true }),
    });

    const session = await adapter.attach("888");
    await adapter.fillText(session, "#prompt-textarea", "accepted");

    expect(fake.seen).toContain("TRUSTED_FILL");
    expect(fake.seen).not.toContain("FILL_TEXT");
    fake.close();
  });

  it("reports a tab that vanished mid-run as tab-not-found, not a null platform", async () => {
    adapter = new ExtensionBridgeAdapter(19246);
    await adapter.start();

    const ws = new WebSocket("ws://127.0.0.1:19246");
    await new Promise<void>((resolve) => {
      ws.onopen = () => resolve();
    });
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      if (typeof msg.type !== "string") return;
      if (msg.type === "LIST_TABS") {
        // An unrecognised URL leaves the platform unresolved; the tab record exists.
        ws.send(JSON.stringify({ v: 2, id: msg.id, ok: true, result: [{ tabId: 31, title: "Unknown", url: "https://example.com/" }] }));
        return;
      }
      if (msg.type === "TAB_INFO") {
        ws.send(JSON.stringify({ v: 2, id: msg.id, ok: false, error: { code: "internal", message: "No tab with id: 31" } }));
        return;
      }
      ws.send(JSON.stringify({ v: 2, id: msg.id, ok: true, result: { ok: true } }));
    };
    ws.send(JSON.stringify({ type: "HANDSHAKE", protocolVersion: 2, clientId: "client-gone", browserFamily: "chrome" }));
    await new Promise((resolve) => setTimeout(resolve, 40));

    const session = await adapter.attach("31");
    const error = await rejectionOf(() => adapter!.evaluate(session, "/* getText */ ['body']"));

    expect(error?.message).toContain("No active browser tab found");
    expect(error?.message).toContain("31");
    ws.close();
  });

  it("keeps read-only commands working while trusted input is unavailable", async () => {
    adapter = new ExtensionBridgeAdapter(19244);
    await adapter.start();

    const fake = await startFakeExtension(19244, "client-777", {
      trustedFill: (id, send) =>
        send({ v: 2, id, ok: false, error: { code: "internal", message: "Another debugger is already attached" } }),
      composerText: () => false,
      domFill: () => ({ ok: false, error: "editor rejected" }),
      getText: () => "readable while the debugger is busy",
    });

    const tabs = await adapter.listTabs();
    expect(tabs.length).toBe(1);

    const session = await adapter.attach("888");
    const text = await adapter.evaluate<string>(session, "/* getText */ ['body']");
    expect(text).toContain("readable");
    fake.close();
  });
});
