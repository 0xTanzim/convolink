import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { handleDaemon } from "../../src/entrypoints/cli.daemon.js";
import { BridgeDaemonService } from "../../src/adapters/daemon/bridge-daemon.service.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { PolicyService } from "../../src/core/services/policy.service.js";
import { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";

describe("CLI Daemon Management (convo daemon)", () => {
  let tmpDir: string;
  let socketPath: string;
  let pidPath: string;
  let daemon: BridgeDaemonService;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-cli-daemon-test-"));
    socketPath = path.join(tmpDir, "bridge.sock");
    pidPath = path.join(tmpDir, "daemon.pid");

    const browser = new FakeBrowserPort();
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
  });

  afterAll(async () => {
    try {
      await daemon.stop();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it("reports daemon OFFLINE when not running", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (...args: unknown[]) => { output += args.join(" ") + "\n"; };

    try {
      const code = await handleDaemon(["status"], { socketPath, pidPath });
      expect(code).toBe(0);
      expect(output).toContain("OFFLINE");
    } finally {
      console.log = origLog;
    }
  });

  it("reports daemon ONLINE when started", async () => {
    await daemon.start();
    let output = "";
    const origLog = console.log;
    console.log = (...args: unknown[]) => { output += args.join(" ") + "\n"; };

    try {
      const code = await handleDaemon(["status"], { socketPath, pidPath });
      expect(code).toBe(0);
      expect(output).toContain("ONLINE");
    } finally {
      console.log = origLog;
    }
  });

  it("stops daemon via handleDaemon stop", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (...args: unknown[]) => { output += args.join(" ") + "\n"; };

    try {
      const code = await handleDaemon(["stop"], { socketPath, pidPath });
      expect(code).toBe(0);
      expect(output).toContain("Daemon stopped");
    } finally {
      console.log = origLog;
    }
  });
});
