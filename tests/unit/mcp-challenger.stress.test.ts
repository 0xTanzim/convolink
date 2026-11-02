import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { Readable, Writable } from "node:stream";
import { McpServer, type JsonRpcRequest } from "../../src/entrypoints/mcp.server.js";
import { runMcpServer, parseIdleTimeout } from "../../src/entrypoints/mcp.js";
import { MCP_TOOLS } from "../../src/entrypoints/mcp.schema.js";
import { executeMcpTool } from "../../src/entrypoints/mcp.tools.js";
import { IdleTimeoutController, parseDurationMs } from "../../src/entrypoints/mcp.lifecycle.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { PolicyService } from "../../src/core/services/policy.service.js";
import { HostEnv } from "../../src/core/env/host-env.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import { BrowserDiscoveryService } from "../../src/adapters/browsers/browser-discovery.js";

describe("Milestone 5 Challenger Adversarial Stress Suite", () => {
  // --------------------------------------------------------------------------
  // Area 1: Zero SQLite & Disk I/O Invariant During Handshake
  // --------------------------------------------------------------------------
  describe("Area 1: Zero SQLite Handshake Invariant", () => {
    it("guarantees 0 orchestrator resolutions and 0 SQLite file creation across repeated handshakes", async () => {
      const sandboxDataDir = path.join(os.tmpdir(), `convo-challenger-xdg-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      const originalXdg = process.env.XDG_DATA_HOME;
      process.env.XDG_DATA_HOME = sandboxDataDir;

      let providerInvocations = 0;
      const fakeProvider = async () => {
        providerInvocations++;
        return new SessionOrchestrator({
          browser: new FakeBrowserPort(),
          drivers: [],
          lockService: new LockService(),
          policyGate: new PolicyService(),
        });
      };

      const server = new McpServer(fakeProvider);

      try {
        // Stress-test with 25 rapid handshake cycles
        for (let i = 0; i < 25; i++) {
          const initRes = await server.handleMessage({
            jsonrpc: "2.0",
            id: i * 3 + 1,
            method: "initialize",
          });
          expect(initRes?.id).toBe(i * 3 + 1);
          expect(initRes?.result?.protocolVersion).toBe("2024-11-05");

          const notifRes = await server.handleMessage({
            jsonrpc: "2.0",
            method: "notifications/initialized",
          });
          expect(notifRes).toBeNull();

          const listRes = await server.handleMessage({
            jsonrpc: "2.0",
            id: i * 3 + 2,
            method: "tools/list",
          });
          expect(listRes?.id).toBe(i * 3 + 2);
          expect(listRes?.result?.tools?.length).toBe(10);

          const pingRes = await server.handleMessage({
            jsonrpc: "2.0",
            id: i * 3 + 3,
            method: "ping",
          });
          expect(pingRes?.id).toBe(i * 3 + 3);
        }

        // Invariant 1: Provider was NEVER invoked
        expect(providerInvocations).toBe(0);

        // Invariant 2: Sandbox directory was NEVER created or touched
        const sqlitePath = path.join(sandboxDataDir, "convolink", "ledger.sqlite");
        expect(fs.existsSync(sqlitePath)).toBe(false);
        expect(fs.existsSync(sandboxDataDir)).toBe(false);
      } finally {
        process.env.XDG_DATA_HOME = originalXdg;
        try {
          if (fs.existsSync(sandboxDataDir)) {
            fs.rmSync(sandboxDataDir, { recursive: true, force: true });
          }
        } catch {}
      }
    });

    it("verifies stdio runner processes rapid handshakes without leaking SQLite or blocking", async () => {
      const messages = [
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" }),
        "",
      ].join("\n");

      let resolvedCount = 0;
      const fakeServer = new McpServer(async () => {
        resolvedCount++;
        return new SessionOrchestrator({
          browser: new FakeBrowserPort(),
          drivers: [],
          lockService: new LockService(),
          policyGate: new PolicyService(),
        });
      });

      const inStream = Readable.from([messages]);
      let outData = "";
      const outStream = new Writable({
        write(chunk, _enc, cb) {
          outData += chunk.toString();
          cb();
        },
      });

      await runMcpServer(inStream, outStream, fakeServer, { exitOnTimeout: false });

      expect(resolvedCount).toBe(0);
      const lines = outData.trim().split("\n");
      expect(lines.length).toBe(3); // init, tools/list, ping (notification produces 0 lines)
    });
  });

  // --------------------------------------------------------------------------
  // Area 2: JIT Container Trigger & Single-Instance Memoization
  // --------------------------------------------------------------------------
  describe("Area 2: JIT Container Trigger & Memoization", () => {
    it("triggers provider resolution exactly once on tools/call and reuses instance", async () => {
      let callCount = 0;
      const orchestrator = new SessionOrchestrator({
        browser: new FakeBrowserPort(),
        drivers: [],
        lockService: new LockService(),
        policyGate: new PolicyService(),
      });

      const server = new McpServer(async () => {
        callCount++;
        return orchestrator;
      });

      expect(callCount).toBe(0);

      // Call tool 1
      const res1 = await server.handleMessage({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: "convo_list_tabs", arguments: {} },
      });
      expect(res1?.id).toBe(10);
      expect(callCount).toBe(1);

      // Call tool 2, 3, 4, 5 in rapid succession
      for (let i = 20; i < 25; i++) {
        const res = await server.handleMessage({
          jsonrpc: "2.0",
          id: i,
          method: "tools/call",
          params: { name: "convo_list_tabs", arguments: {} },
        });
        expect(res?.id).toBe(i);
        expect(callCount).toBe(1); // Memoized, must remain 1
      }
    });

    it("verifies convo_profile operates on-demand without prior initialization", async () => {
      const orchestrator = new SessionOrchestrator({
        browser: new FakeBrowserPort(),
        drivers: [],
        lockService: new LockService(),
        policyGate: new PolicyService(),
      });

      const server = new McpServer(async () => orchestrator);

      const res = await server.handleMessage({
        jsonrpc: "2.0",
        id: 99,
        method: "tools/call",
        params: { name: "convo_profile", arguments: { action: "list" } },
      });

      expect(res?.id).toBe(99);
      expect(res?.result?.isError).toBe(false);
      expect(res?.result?.content?.[0]?.text).toContain("Browser Profiles:");
    });
  });

  // --------------------------------------------------------------------------
  // Area 3: Inactivity & Idle Timeout Adversarial Edge Cases
  // --------------------------------------------------------------------------
  describe("Area 3: Inactivity Controller Adversarial Scenarios", () => {
    it("handles zero and boundary durations gracefully", () => {
      expect(parseDurationMs("0")).toBe(0);
      expect(parseDurationMs("0s")).toBe(0);
      expect(parseDurationMs("0m")).toBe(0);
      expect(parseDurationMs("0h")).toBe(0);
      expect(parseDurationMs("0d")).toBe(0);
      expect(parseDurationMs("1.5s")).toBe(1500);
      expect(parseDurationMs("0.5m")).toBe(30000);
    });

    it("parses CLI timeout flags under diverse position combinations", () => {
      expect(parseIdleTimeout(["--idle-timeout=5m"])).toBe(5 * 60 * 1000);
      expect(parseIdleTimeout(["--idle-timeout", "2h"])).toBe(2 * 60 * 60 * 1000);
      expect(parseIdleTimeout(["--other", "flag", "--idle-timeout=10s"])).toBe(10 * 1000);
      expect(parseIdleTimeout(["--other", "--idle-timeout", "500ms"])).toBe(500);
      expect(parseIdleTimeout([])).toBe(15 * 60 * 1000); // Default 15m
    });

    it("prevents premature timeout when rapid micro-bursts of activity occur", async () => {
      let expired = false;
      const controller = new IdleTimeoutController({
        timeoutMs: 40,
        onTimeout: () => { expired = true; },
      });

      // Keep ticking activity every 15ms for 60ms total (longer than 40ms timeout)
      for (let i = 0; i < 4; i++) {
        await new Promise((r) => setTimeout(r, 15));
        controller.recordActivity();
        expect(expired).toBe(false);
      }

      // Stop activity and verify it expires after window
      await new Promise((r) => setTimeout(r, 50));
      expect(expired).toBe(true);
      controller.stop();
    });
  });

  // --------------------------------------------------------------------------
  // Area 4: Mutex Lock Cleanup Resilience
  // --------------------------------------------------------------------------
  describe("Area 4: Mutex Lock Cleanup Resilience", () => {
    it("ignores corrupted lockfiles without throwing and cleans only matching PID locks", () => {
      HostEnv.ensureDirs();
      const lockDir = HostEnv.getLockDir();
      const testPid = process.pid;

      const myLock = path.join(lockDir, `tab-challenger-valid-${testPid}.lock`);
      const corruptLock = path.join(lockDir, `tab-challenger-corrupt-${testPid}.lock`);
      const emptyLock = path.join(lockDir, `tab-challenger-empty-${testPid}.lock`);

      fs.writeFileSync(myLock, JSON.stringify({ pid: testPid, targetId: "test-target", acquiredAt: new Date().toISOString() }));
      fs.writeFileSync(corruptLock, "NOT_JSON_DATA_CORRUPT{{{");
      fs.writeFileSync(emptyLock, "");

      try {
        expect(fs.existsSync(myLock)).toBe(true);
        expect(fs.existsSync(corruptLock)).toBe(true);

        // cleanupProcessLocks must not throw on corrupt files
        const cleaned = LockService.cleanupProcessLocks(testPid);
        expect(cleaned).toBeGreaterThanOrEqual(1);
        expect(fs.existsSync(myLock)).toBe(false);
      } finally {
        try { fs.unlinkSync(corruptLock); } catch {}
        try { fs.unlinkSync(emptyLock); } catch {}
      }
    });
  });

  // --------------------------------------------------------------------------
  // Area 5: 100% Multi-Profile Discovery Schema & Functional Integrity
  // --------------------------------------------------------------------------
  describe("Area 5: Multi-Profile Functional & Schema Integrity", () => {
    it("verifies the 10 smart cognitive MCP tools are defined with compliant inputSchema structures", () => {
      expect(MCP_TOOLS.length).toBe(10);
      const names = MCP_TOOLS.map((t) => t.name);

      expect(names).toContain("convo_ask");
      expect(names).toContain("convo_compare");
      expect(names).toContain("convo_doctor");
      expect(names).toContain("convo_list_tabs");
      expect(names).toContain("convo_tab");
      expect(names).toContain("convo_search");
      expect(names).toContain("convo_thread");
      expect(names).toContain("convo_profile");
      expect(names).toContain("convo_status");
      expect(names).toContain("convo_setup");

      for (const tool of MCP_TOOLS) {
        expect(tool.name).toBeString();
        expect(tool.description).toBeString();
        expect(tool.inputSchema.type).toBe("object");
        expect(tool.inputSchema.properties).toBeObject();
      }
    });

    it("verifies BrowserDiscoveryService discovers multi-profiles accurately", async () => {
      const sandboxDir = path.join(os.tmpdir(), `convo-profile-discovery-${Date.now()}`);
      fs.mkdirSync(sandboxDir, { recursive: true });

      const fakeLocalState = {
        profile: {
          info_cache: {
            Default: { name: "Corp AI", user_name: "ai-engineer@enterprise.com", gaia_name: "Engineer" },
            "Profile 2": { name: "Personal AI", user_name: "personal@gmail.com", gaia_name: "Personal" },
          },
        },
      };

      fs.writeFileSync(path.join(sandboxDir, "Local State"), JSON.stringify(fakeLocalState));

      try {
        const discovery = new BrowserDiscoveryService([sandboxDir]);
        const profiles = await discovery.discoverProfiles();

        expect(profiles.length).toBe(2);
        expect(profiles.some((p) => p.email === "ai-engineer@enterprise.com")).toBe(true);
        expect(profiles.some((p) => p.email === "personal@gmail.com")).toBe(true);
      } finally {
        try { fs.rmSync(sandboxDir, { recursive: true, force: true }); } catch {}
      }
    });
  });
});
