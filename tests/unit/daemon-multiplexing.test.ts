import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as net from "node:net";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { DaemonClient } from "../../src/adapters/daemon/daemon-client.js";
import { BridgeDaemonService } from "../../src/adapters/daemon/bridge-daemon.service.js";
import type { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import { ConvoError } from "../../src/core/errors/convo-error.js";

describe("Daemon IPC Multiplexing & Connection Pooling", () => {
  let tempDir: string;
  let socketPath: string;
  let pidPath: string;
  let server: net.Server | null = null;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-ipc-test-"));
    socketPath = path.join(tempDir, "test-bridge.sock");
    pidPath = path.join(tempDir, "test-daemon.pid");
  });

  afterEach(() => {
    if (server) {
      server.close();
      server = null;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("reuses a persistent connection across multiple sequential and concurrent requests", async () => {
    let connectionCount = 0;
    const handledRequests: string[] = [];

    server = net.createServer((socket) => {
      connectionCount++;
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        let newlineIdx: number;
        while ((newlineIdx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newlineIdx).trim();
          buffer = buffer.slice(newlineIdx + 1);
          if (!line) continue;
          const req = JSON.parse(line);
          handledRequests.push(req.id);
          // Echo back with matching request ID
          socket.write(JSON.stringify({ id: req.id, ok: true, result: { echoed: req.command } }) + "\n");
        }
      });
    });

    await new Promise<void>((resolve) => server!.listen(socketPath, resolve));

    const client = new DaemonClient({ socketPath });

    // Sequential requests
    const res1 = await client.sendRequest<{ echoed: string }>("ping");
    const res2 = await client.sendRequest<{ echoed: string }>("doctor");

    expect(res1.ok).toBe(true);
    expect(res1.result?.echoed).toBe("ping");
    expect(res2.ok).toBe(true);
    expect(res2.result?.echoed).toBe("doctor");

    // Concurrent pipelined requests
    const [c1, c2, c3] = await Promise.all([
      client.sendRequest<{ echoed: string }>("list"),
      client.sendRequest<{ echoed: string }>("doctor"),
      client.sendRequest<{ echoed: string }>("ping"),
    ]);

    expect(c1.ok).toBe(true);
    expect(c2.ok).toBe(true);
    expect(c3.ok).toBe(true);
    expect(c1.result?.echoed).toBe("list");
    expect(c2.result?.echoed).toBe("doctor");
    expect(c3.result?.echoed).toBe("ping");

    // All 5 requests should have been served over the single persistent connection!
    expect(connectionCount).toBe(1);
    expect(handledRequests.length).toBe(5);

    client.disconnect();
  });

  it("transparently reconnects if the daemon socket drops", async () => {
    let currentSocket: net.Socket | null = null;
    server = net.createServer((socket) => {
      currentSocket = socket;
      let buffer = "";
      socket.on("data", (chunk) => {
        buffer += chunk.toString("utf8");
        const newlineIdx = buffer.indexOf("\n");
        if (newlineIdx !== -1) {
          const req = JSON.parse(buffer.slice(0, newlineIdx).trim());
          buffer = buffer.slice(newlineIdx + 1);
          socket.write(JSON.stringify({ id: req.id, ok: true, result: "ok" }) + "\n");
        }
      });
    });

    await new Promise<void>((resolve) => server!.listen(socketPath, resolve));

    const client = new DaemonClient({ socketPath });

    const first = await client.sendRequest("ping");
    expect(first.ok).toBe(true);

    // Forcibly destroy socket from server side
    (currentSocket as net.Socket | null)?.destroy();
    await new Promise((r) => setTimeout(r, 50));

    // Next request should seamlessly reconnect
    const second = await client.sendRequest("ping");
    expect(second.ok).toBe(true);

    client.disconnect();
  });

  describe("ensureDaemonRunning Atomic Spawn Lock", () => {
    it("prevents double-spawn races by allowing only one process to spawn while others wait", async () => {
      const { ensureDaemonRunning } = await import("../../src/entrypoints/cli.daemon.js");
      const spawnLockPath = `${socketPath}.spawning`;

      // Simulate an active spawn lock by another process
      fs.writeFileSync(spawnLockPath, JSON.stringify({ pid: process.pid, createdAt: Date.now() }));

      // Launch fake daemon after 300ms to simulate the first spawner completing
      setTimeout(() => {
        server = net.createServer((socket) => {
          let buf = "";
          socket.on("data", (chunk) => {
            buf += chunk.toString("utf8");
            let idx: number;
            while ((idx = buf.indexOf("\n")) !== -1) {
              const line = buf.slice(0, idx).trim();
              buf = buf.slice(idx + 1);
              if (!line) continue;
              try {
                const req = JSON.parse(line);
                socket.write(JSON.stringify({ id: req.id, ok: true, result: "pong" }) + "\n");
              } catch {}
            }
          });
        });
        server.listen(socketPath, () => {
          try { fs.unlinkSync(spawnLockPath); } catch {}
        });
      }, 300);

      const running = await ensureDaemonRunning({ socketPath, pidPath });
      expect(running).toBe(true);
      expect(fs.existsSync(spawnLockPath)).toBe(false);
    });
  });

  describe("MCP Daemon-as-Sole-Owner Invariant", () => {
    it("fails fast with daemon-required when daemon is offline for gecko or extension transport", async () => {
      const { forward, setFallbackOrchestrator } = await import("../../src/entrypoints/mcp.orchestrator.js");
      setFallbackOrchestrator(null);

      const fakeClient = {
        isAlive: async () => false,
        sendRequest: async () => { throw new Error("connect ECONNREFUSED"); },
      } as any;

      const originalEnv = process.env.CONVOLINK_TRANSPORT;
      process.env.CONVOLINK_TRANSPORT = "firefox-bidi";
      try {
        const caller = forward(fakeClient, "list");
        await expect(caller()).rejects.toThrow("The ConvoLink daemon is required");
      } finally {
        if (originalEnv) process.env.CONVOLINK_TRANSPORT = originalEnv;
        else delete process.env.CONVOLINK_TRANSPORT;
      }
    });
  });
});
