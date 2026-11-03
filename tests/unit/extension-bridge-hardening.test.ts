import { afterEach, describe, expect, it } from "bun:test";
import { ExtensionBridgeAdapter } from "../../src/adapters/browsers/extension-bridge.adapter.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface FakeClient {
  readonly ws: WebSocket;
  readonly received: Array<Record<string, unknown>>;
}

function handshake(clientId: string, profileLabel = "Personal"): Record<string, unknown> {
  return {
    type: "HANDSHAKE",
    protocolVersion: 2,
    clientId,
    installationProfileId: `prof-${clientId}`,
    connectionId: `conn-${clientId}`,
    browserFamily: "chrome",
    profileLabel,
    extensionVersion: "2.0.0",
  };
}

async function connect(
  port: number,
  clientId: string,
  respond: (message: Record<string, unknown>, ws: WebSocket) => boolean,
): Promise<FakeClient> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  await new Promise<void>((resolve) => { ws.onopen = () => resolve(); });
  const received: Array<Record<string, unknown>> = [];
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data.toString()) as Record<string, unknown>;
    received.push(message);
    respond(message, ws);
  };
  ws.send(JSON.stringify(handshake(clientId)));
  await sleep(30);
  return { ws, received };
}

function reply(ws: WebSocket, message: Record<string, unknown>, result: unknown): void {
  ws.send(JSON.stringify({ v: 2, id: message.id, ok: true, result }));
}

describe("ExtensionBridgeAdapter hardening", () => {
  let adapter: ExtensionBridgeAdapter | null = null;

  afterEach(async () => {
    await adapter?.stop();
    adapter = null;
  });

  it("rejects a v1 handshake with protocol-mismatch", async () => {
    adapter = new ExtensionBridgeAdapter(19250);
    await adapter.start();

    const ws = new WebSocket("ws://127.0.0.1:19250");
    await new Promise<void>((resolve) => { ws.onopen = () => resolve(); });
    const ack = await new Promise<Record<string, unknown>>((resolve) => {
      ws.onmessage = (event) => resolve(JSON.parse(event.data.toString()));
      ws.send(JSON.stringify({ type: "HANDSHAKE", protocolVersion: 1, clientId: "old" }));
    });

    expect(ack.success).toBe(false);
    expect(ack.error).toBe("protocol-mismatch");
    expect(adapter.getConnectedClients()).toHaveLength(0);
    ws.close();
  });

  it("times out one request without poisoning the client", async () => {
    adapter = new ExtensionBridgeAdapter(19251, undefined, { requestTimeoutMs: 40 });
    await adapter.start();

    const client = await connect(19251, "timeout-client", (message, ws) => {
      if (message.type === "LIST_TABS") {
        reply(ws, message, [{ tabId: 1, title: "Tab", url: "https://chatgpt.com/" }]);
        return true;
      }
      return false;
    });

    const tabs = await adapter.listTabs();
    expect(tabs[0]?.targetId).toBe("1");

    const pending = adapter.evaluate({ sessionId: "s", targetId: "1", adapterId: "extension-bridge" }, "location.href");
    await expect(pending).rejects.toMatchObject({ code: "transport-timeout" });
    expect(adapter.getConnectedClients()).toHaveLength(1);
    client.ws.close();
  });

  it("rejects pending work when the client disconnects", async () => {
    adapter = new ExtensionBridgeAdapter(19252, undefined, { requestTimeoutMs: 5000 });
    await adapter.start();

    const client = await connect(19252, "drop-client", (message, ws) => {
      if (message.type === "LIST_TABS") {
        reply(ws, message, [{ tabId: 2, title: "Tab", url: "https://chatgpt.com/" }]);
        return true;
      }
      return false;
    });

    await adapter.listTabs();
    const pending = adapter.evaluate({ sessionId: "s", targetId: "2", adapterId: "extension-bridge" }, "location.href");
    await sleep(20);
    client.ws.close();

    await expect(pending).rejects.toMatchObject({ code: "transport-disconnected" });
  });

  it("evicts a client that stops heartbeating", async () => {
    adapter = new ExtensionBridgeAdapter(19253, undefined, { clientTtlMs: 30, sweepIntervalMs: 10 });
    await adapter.start();

    const client = await connect(19253, "stale-client", () => false);
    expect(adapter.getConnectedClients()).toHaveLength(1);

    await sleep(80);
    expect(adapter.getConnectedClients()).toHaveLength(0);
    client.ws.close();
  });

  it("routes a compound target only to its owning client", async () => {
    adapter = new ExtensionBridgeAdapter(19254, undefined, { requestTimeoutMs: 2000 });
    await adapter.start();

    const alpha = await connect(19254, "alpha", (message, ws) => {
      if (message.type === "LIST_TABS") reply(ws, message, [{ tabId: 11, title: "A", url: "https://chatgpt.com/" }]);
      else if (message.type === "GET_URL") reply(ws, message, "https://chatgpt.com/alpha");
      else return false;
      return true;
    });
    const beta = await connect(19254, "beta", (message, ws) => {
      if (message.type === "LIST_TABS") reply(ws, message, [{ tabId: 22, title: "B", url: "https://chat.deepseek.com/" }]);
      else if (message.type === "GET_URL") reply(ws, message, "https://chat.deepseek.com/beta");
      else return false;
      return true;
    });

    const tabs = await adapter.listTabs();
    const alphaTab = tabs.find((tab) => tab.targetId === "alpha::11");
    expect(alphaTab).toBeDefined();

    const url = await adapter.evaluate(
      { sessionId: "s", targetId: "alpha::11", adapterId: "extension-bridge" },
      "location.href",
    );
    expect(url).toBe("https://chatgpt.com/alpha");
    expect(beta.received.some((message) => message.type === "GET_URL")).toBe(false);
    expect(alpha.received.some((message) => message.type === "GET_URL")).toBe(true);

    alpha.ws.close();
    beta.ws.close();
  });
});

describe("Extension expression contract", () => {
  let adapter: ExtensionBridgeAdapter | null = null;

  afterEach(async () => {
    await adapter?.stop();
    adapter = null;
  });

  it("maps every page-events and driver probe to an operation", async () => {
    const { buildMountedProbeExpr, buildQuietProbeExpr, buildReadyProbeExpr, buildStatusProbeExpr } =
      await import("../../src/adapters/platforms/page-events.js");
    const { getChatGPTAwaitCompletionExpr, CHATGPT_RESOLVE_SELECTORS_EXPR } =
      await import("../../src/adapters/platforms/chatgpt.scripts.js");
    const { getClaudeAwaitCompletionExpr, getClaudeResolveSelectorsExpr } =
      await import("../../src/adapters/platforms/claude.scripts.js");
    const { getDeepSeekAwaitCompletionExpr, DEEPSEEK_RESOLVE_SELECTORS_EXPR } =
      await import("../../src/adapters/platforms/deepseek.scripts.js");
    const { getGeminiAwaitCompletionExpr, GEMINI_RESOLVE_SELECTORS_EXPR } =
      await import("../../src/adapters/platforms/gemini.scripts.js");

    adapter = new ExtensionBridgeAdapter(19255, undefined, { requestTimeoutMs: 1000 });
    await adapter.start();

    const client = await connect(19255, "contract-client", (message, ws) => {
      if (message.type === "LIST_TABS") reply(ws, message, [{ tabId: 9, title: "Tab", url: "https://chatgpt.com/c/1" }]);
      else reply(ws, message, true);
      return true;
    });

    await adapter.listTabs();
    const session = { sessionId: "s", targetId: "9", adapterId: "extension-bridge" as const };

    const cases: Array<[string, string]> = [
      ["location.href", "GET_URL"],
      [buildQuietProbeExpr(), "PROBE_QUIET"],
      [buildMountedProbeExpr("textarea"), "PROBE_MOUNTED"],
      [buildReadyProbeExpr("textarea", "button.send"), "PROBE_READY"],
      ["/* readThread */", "READ_THREAD"],
      [buildStatusProbeExpr(getChatGPTAwaitCompletionExpr(0)), "PROBE_STATUS"],
      [buildStatusProbeExpr(getClaudeAwaitCompletionExpr(0)), "PROBE_STATUS"],
      [buildStatusProbeExpr(getDeepSeekAwaitCompletionExpr(0)), "PROBE_STATUS"],
      [buildStatusProbeExpr(getGeminiAwaitCompletionExpr(0)), "PROBE_STATUS"],
      [CHATGPT_RESOLVE_SELECTORS_EXPR, "PROBE_SELECTORS"],
      [getClaudeResolveSelectorsExpr(), "PROBE_SELECTORS"],
      [DEEPSEEK_RESOLVE_SELECTORS_EXPR, "PROBE_SELECTORS"],
      [GEMINI_RESOLVE_SELECTORS_EXPR, "PROBE_SELECTORS"],
    ];

    for (const [expression, expected] of cases) {
      const before = client.received.length;
      await adapter.evaluate(session, expression);
      const sent = client.received.slice(before).find((message) => typeof message.type === "string" && message.type !== "HEARTBEAT_ACK");
      expect(sent?.type).toBe(expected);
    }

    client.ws.close();
  });
});

describe("Extension tab removal", () => {
  let adapter: ExtensionBridgeAdapter | null = null;

  afterEach(async () => {
    await adapter?.stop();
    adapter = null;
  });

  it("drops a removed target from routing", async () => {
    adapter = new ExtensionBridgeAdapter(19256, undefined, { requestTimeoutMs: 500 });
    await adapter.start();

    const client = await connect(19256, "removal-client", (message, ws) => {
      if (message.type === "LIST_TABS") reply(ws, message, [{ tabId: 77, title: "Tab", url: "https://chatgpt.com/" }]);
      else reply(ws, message, true);
      return true;
    });

    await adapter.listTabs();
    client.ws.send(JSON.stringify({ v: 2, event: "TAB_REMOVED", targetId: "77" }));
    await sleep(20);

    await expect(
      adapter.evaluate({ sessionId: "s", targetId: "removal-client::77", adapterId: "extension-bridge" }, "location.href"),
    ).rejects.toBeDefined();
    client.ws.close();
  });
});
