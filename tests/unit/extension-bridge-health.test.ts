import { afterEach, describe, expect, it } from "bun:test";
import { ExtensionBridgeAdapter } from "../../src/adapters/browsers/extension-bridge.adapter.js";

describe("ExtensionBridgeAdapter Health & Port Resilience", () => {
  let server: ReturnType<typeof Bun.serve> | null = null;
  let adapter: ExtensionBridgeAdapter | null = null;

  afterEach(async () => {
    if (server) {
      server.stop(true);
      server = null;
    }
    if (adapter) {
      await adapter.stop();
      adapter = null;
    }
  });

  it("probes status endpoint when port is already occupied by a bridge server", async () => {
    const testPort = 19225;
    // Simulate an existing running daemon bridge server on testPort
    server = Bun.serve({
      port: testPort,
      hostname: "127.0.0.1",
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/status") {
          return Response.json({
            protocolVersion: 2,
            clients: [
              {
                browserFamily: "chrome",
                profileLabel: "Work",
                extensionVersion: "2.1.0",
                tabsCount: 3,
              },
            ],
          });
        }
        return new Response("OK");
      },
    });

    adapter = new ExtensionBridgeAdapter(testPort);
    // Health should probe /status and discover the running daemon's clients without throwing EADDRINUSE
    const health = await adapter.health();
    expect(health.ok).toBe(true);
    expect(health.openTabsCount).toBe(3);
    expect(health.endpoint).toContain("chrome [Work] v2.1.0");
  });
});
