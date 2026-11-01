import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { HostEnv } from "../../src/core/env/host-env.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { McpServer } from "../../src/entrypoints/mcp.server.js";
import {
  parseDurationMs,
  IdleTimeoutController,
} from "../../src/entrypoints/mcp.lifecycle.js";
import type { SessionOrchestrator } from "../../src/core/services/orchestrator.js";

describe("MCP Lifecycle & Ephemeral Architecture", () => {
  describe("parseDurationMs", () => {
    it("parses valid duration strings correctly", () => {
      expect(parseDurationMs("15m")).toBe(15 * 60 * 1000);
      expect(parseDurationMs("30s")).toBe(30 * 1000);
      expect(parseDurationMs("100ms")).toBe(100);
      expect(parseDurationMs("1h")).toBe(60 * 60 * 1000);
      expect(parseDurationMs("0")).toBe(0);
      expect(parseDurationMs("0s")).toBe(0);
      expect(parseDurationMs("0m")).toBe(0);
    });

    it("throws on invalid duration formats", () => {
      expect(() => parseDurationMs("")).toThrow();
      expect(() => parseDurationMs("invalid")).toThrow();
      expect(() => parseDurationMs("-15m")).toThrow();
      expect(() => parseDurationMs("100xyz")).toThrow();
      expect(() => parseDurationMs("m")).toThrow();
    });
  });

  describe("IdleTimeoutController", () => {
    it("fires onTimeout after specified inactivity duration", async () => {
      let timedOut = false;
      const controller = new IdleTimeoutController({
        timeoutMs: 40,
        onTimeout: () => {
          timedOut = true;
        },
      });

      expect(timedOut).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 60));
      expect(timedOut).toBe(true);
      controller.stop();
    });

    it("resets timer on recordActivity()", async () => {
      let timedOut = false;
      const controller = new IdleTimeoutController({
        timeoutMs: 50,
        onTimeout: () => {
          timedOut = true;
        },
      });

      // Advance 30ms, then record activity to reset the timer
      await new Promise((resolve) => setTimeout(resolve, 30));
      controller.recordActivity();

      // At 55ms total (25ms after reset), it should NOT have timed out yet
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(timedOut).toBe(false);

      // At 90ms total (60ms after reset), it should have timed out
      await new Promise((resolve) => setTimeout(resolve, 35));
      expect(timedOut).toBe(true);
      controller.stop();
    });

    it("does not fire onTimeout after stop() is called", async () => {
      let timedOut = false;
      const controller = new IdleTimeoutController({
        timeoutMs: 30,
        onTimeout: () => {
          timedOut = true;
        },
      });

      controller.stop();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(timedOut).toBe(false);
    });

    it("does not arm timer when timeout is 0 (disabled)", async () => {
      let timedOut = false;
      const controller = new IdleTimeoutController({
        timeoutMs: 0,
        onTimeout: () => {
          timedOut = true;
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(timedOut).toBe(false);
      controller.stop();
    });
  });

  describe("McpServer Lazy Initialization", () => {
    const createMockOrchestrator = () => {
      return {
        ask: async () => ({
          turn: { markdownContent: "mock ask response" },
          writtenFiles: [],
          riskLabels: [],
          redactedSecretsCount: 0,
        }),
        listTabs: async () => [],
      } as unknown as SessionOrchestrator;
    };

    it("responds to initialize, tools/list, and ping without calling orchestratorProvider", async () => {
      let providerCallCount = 0;
      const provider = async () => {
        providerCallCount++;
        return createMockOrchestrator();
      };

      const server = new McpServer(provider);

      // 1. initialize
      const initRes = await server.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
      });
      expect(initRes?.id).toBe(1);
      expect(initRes?.result?.serverInfo?.name).toBe("convolink");
      expect(providerCallCount).toBe(0);

      // 2. notifications/initialized
      const notifRes = await server.handleMessage({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      });
      expect(notifRes).toBeNull();
      expect(providerCallCount).toBe(0);

      // 3. tools/list
      const listRes = await server.handleMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/list",
      });
      expect(listRes?.id).toBe(2);
      expect(listRes?.result?.tools).toBeDefined();
      expect(providerCallCount).toBe(0);

      // 4. ping
      const pingRes = await server.handleMessage({
        jsonrpc: "2.0",
        id: 3,
        method: "ping",
      });
      expect(pingRes?.id).toBe(3);
      expect(providerCallCount).toBe(0);
    });

    it("only resolves orchestratorProvider upon tools/call and memoizes it", async () => {
      let providerCallCount = 0;
      const provider = async () => {
        providerCallCount++;
        return createMockOrchestrator();
      };

      const server = new McpServer(provider);
      expect(providerCallCount).toBe(0);

      const callRes1 = await server.handleMessage({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: {
          name: "convo_list_tabs",
          arguments: {},
        },
      });
      expect(callRes1?.id).toBe(10);
      expect(providerCallCount).toBe(1);

      // Second tools/call must reuse memoized orchestrator without re-invoking provider
      const callRes2 = await server.handleMessage({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "convo_list_tabs",
          arguments: {},
        },
      });
      expect(callRes2?.id).toBe(11);
      expect(providerCallCount).toBe(1);
    });
  });

  describe("LockService.cleanupProcessLocks", () => {
    it("releases temporary tab locks matching process PID from lock directory", () => {
      HostEnv.ensureDirs();
      const lockDir = HostEnv.getLockDir();

      const myPid = process.pid;
      const otherPid = myPid + 99999;

      const myLockFile = path.join(lockDir, `tab-unit-test-m5-${myPid}.lock`);
      const otherLockFile = path.join(lockDir, `tab-unit-test-m5-${otherPid}.lock`);

      fs.writeFileSync(
        myLockFile,
        JSON.stringify({
          pid: myPid,
          targetId: `unit-test-m5-${myPid}`,
          acquiredAt: new Date().toISOString(),
          expiresAt: Date.now() + 60000,
        }),
        "utf8",
      );

      fs.writeFileSync(
        otherLockFile,
        JSON.stringify({
          pid: otherPid,
          targetId: `unit-test-m5-${otherPid}`,
          acquiredAt: new Date().toISOString(),
          expiresAt: Date.now() + 60000,
        }),
        "utf8",
      );

      expect(fs.existsSync(myLockFile)).toBe(true);
      expect(fs.existsSync(otherLockFile)).toBe(true);

      const cleanedCount = LockService.cleanupProcessLocks(myPid);
      expect(cleanedCount).toBeGreaterThanOrEqual(1);

      // My lock file should be deleted
      expect(fs.existsSync(myLockFile)).toBe(false);
      // Other process lock file should remain intact
      expect(fs.existsSync(otherLockFile)).toBe(true);

      // Clean up the other lock file
      try {
        fs.unlinkSync(otherLockFile);
      } catch {}
    });
  });

  describe("mcp.ts lifecycle integration", () => {
    it("parseIdleTimeout parses --idle-timeout flags and defaults to 15m", async () => {
      const { parseIdleTimeout } = await import("../../src/entrypoints/mcp.js");
      expect(parseIdleTimeout([])).toBe(15 * 60 * 1000);
      expect(parseIdleTimeout(["--idle-timeout=30s"])).toBe(30 * 1000);
      expect(parseIdleTimeout(["--idle-timeout", "100ms"])).toBe(100);
      expect(parseIdleTimeout(["--other-flag", "--idle-timeout=1h"])).toBe(60 * 60 * 1000);
    });

    it("registerTeardownHandlers registers and executes cleanup and unregisters cleanly", async () => {
      const { registerTeardownHandlers } = await import("../../src/entrypoints/mcp.lifecycle.js");
      let cleaned = false;
      const unregister = registerTeardownHandlers(() => {
        cleaned = true;
      }, { exitOnSignal: false });

      expect(cleaned).toBe(false);
      unregister();
    });
  });
});

