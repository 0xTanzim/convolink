import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { BridgeDaemonService } from "../../src/adapters/daemon/bridge-daemon.service.js";
import { DaemonClient } from "../../src/adapters/daemon/daemon-client.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { PolicyService } from "../../src/core/services/policy.service.js";
import { SessionOrchestrator } from "../../src/core/services/orchestrator.js";

describe("ConvoLink Bridge Daemon & IPC Client", () => {
  let tmpDir: string;
  let socketPath: string;
  let pidPath: string;
  let daemon: BridgeDaemonService;
  let client: DaemonClient;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-daemon-test-"));
    socketPath = path.join(tmpDir, "bridge.sock");
    pidPath = path.join(tmpDir, "daemon.pid");

    const browser = new FakeBrowserPort();
    browser.listTabs = async () => [
      { targetId: "ds-tab-1", title: "DeepSeek Chat", url: "https://chat.deepseek.com/a/chat/s/1" },
    ];
    browser.evalResponseMap.set("resolveSelectors", {
      ok: true, layoutVariant: "v1", composerSelector: "textarea", sendButtonSelector: "button",
      stopIndicatorSelector: null, turnContainerSelector: ".turn",
    });
    browser.evalResponseMap.set("awaitCompletion", {
      mdCount: 1, hasNewTurn: true, isGenerating: false, turnIndex: 0,
      text: "Daemon reply via IPC", codeBlocks: [],
    });

    const orchestrator = new SessionOrchestrator({
      browser,
      drivers: [new DeepSeekDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
    });

    daemon = new BridgeDaemonService({
      orchestrator,
      socketPath,
      pidPath,
    });

    await daemon.start();
    client = new DaemonClient({ socketPath });
  });

  afterAll(async () => {
    try {
      await daemon.stop();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("checks liveness using ping command", async () => {
    const isAlive = await client.isAlive();
    expect(isAlive).toBe(true);
  });

  it("dispatches ask command over IPC and receives orchestrator result", async () => {
    const res = await client.sendRequest<{ turn: { markdownContent: string } }>("ask", {
      prompt: "Hello via daemon IPC",
      targetId: "ds-tab-1",
    });

    expect(res.ok).toBe(true);
    expect(res.result?.turn.markdownContent).toBe("Daemon reply via IPC");
  });

  it("dispatches list command over IPC and returns tab descriptors", async () => {
    const res = await client.sendRequest<any[]>("list", {});
    expect(res.ok).toBe(true);
    expect(res.result?.length).toBe(1);
    expect(res.result?.[0]?.targetId).toBe("ds-tab-1");
  });

  it("handles concurrent requests without packet corruption", async () => {
    const [res1, res2, res3] = await Promise.all([
      client.sendRequest<any>("list", {}),
      client.sendRequest<any>("ping", {}),
      client.sendRequest<any>("list", {}),
    ]);

    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    expect(res3.ok).toBe(true);
  });

  it("cleans up socket file on stop", async () => {
    await daemon.stop();
    expect(fs.existsSync(socketPath)).toBe(false);
  });
});
