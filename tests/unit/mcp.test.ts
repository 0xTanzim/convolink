import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { McpServer } from "../../src/entrypoints/mcp.server.js";
import { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { PolicyService } from "../../src/core/services/policy.service.js";

describe("McpServer (JSON-RPC over stdio)", () => {
  const createTestServer = (options?: {
    workDir?: string;
    discoverProfiles?: () => Promise<import("../../src/adapters/browsers/browser-discovery.js").DiscoveredProfile[]>;
  }) => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("resolveSelectors", {
      ok: true, layoutVariant: "v1", composerSelector: "textarea", sendButtonSelector: "button",
      stopIndicatorSelector: null, turnContainerSelector: ".turn",
    });
    browser.evalResponseMap.set("awaitCompletion", {
      mdCount: 1, hasNewTurn: true, isGenerating: false, turnIndex: 0,
      text: "MCP Assistant reply", codeBlocks: [{ language: "ts", code: "const mcp = 1;" }],
    });

    const orchestrator = new SessionOrchestrator({
      browser,
      drivers: [new DeepSeekDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
    });

    return new McpServer({
      orchestrator,
      workDir: options?.workDir,
      ...(options?.discoverProfiles ? { discoverProfiles: options.discoverProfiles } : {}),
    });
  };

  it("handles initialize method and returns server capabilities", async () => {
    const server = createTestServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test-client" } },
    });

    expect(response?.id).toBe(1);
    expect(response?.result?.protocolVersion).toBe("2024-11-05");
    expect(response?.result?.serverInfo?.name).toBe("convolink");
    expect(response?.result?.capabilities?.tools).toBeDefined();
  });

  it("handles tools/list and returns the 11 smart cognitive tools", async () => {
    const server = createTestServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    expect(response?.id).toBe(2);
    const tools = response?.result?.tools;
    expect(tools).toBeDefined();
    expect(tools!.length).toBe(11);

    const names = tools!.map((t) => t.name);
    expect(names).toContain("convo_ask");
    expect(names).toContain("convo_compare");
    expect(names).toContain("convo_doctor");
    expect(names).toContain("convo_list_tabs");
    expect(names).toContain("convo_tab");
    expect(names).toContain("convo_search");
    expect(names).toContain("convo_thread");
    expect(names).toContain("convo_profile");

    const askTool = tools!.find((t) => t.name === "convo_ask");
    expect(askTool).toBeDefined();
    expect((askTool?.inputSchema.properties as any).think).toBeDefined();
    expect((askTool?.inputSchema.properties as any).search).toBeDefined();
  });

  it("handles tools/call for convo_doctor with and without fix", async () => {
    const server = createTestServer();
    const docRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: { name: "convo_doctor", arguments: {} },
    });
    expect(docRes?.id).toBe(30);
    expect(docRes?.result?.content?.[0]?.text).toContain("capabilities");

    const fixRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 31,
      method: "tools/call",
      params: { name: "convo_doctor", arguments: { fix: true } },
    });
    expect(fixRes?.id).toBe(31);
    expect(fixRes?.result?.content?.[0]?.text).toContain("fixResult");
  });

  it("handles tools/call for convo_list_tabs", async () => {
    const server = createTestServer();
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 32,
      method: "tools/call",
      params: { name: "convo_list_tabs", arguments: {} },
    });
    expect(res?.id).toBe(32);
    expect(res?.result?.content?.[0]?.text).toContain("DeepSeek");
  });

  it("handles tools/call for convo_tab actions and self-correcting errors", async () => {
    const server = createTestServer();
    const newRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 33,
      method: "tools/call",
      params: { name: "convo_tab", arguments: { action: "new", target: "deepseek" } },
    });
    expect(newRes?.id).toBe(33);
    expect(newRes?.result?.content?.[0]?.text).toContain("Spawned tab");

    const closeRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 34,
      method: "tools/call",
      params: { name: "convo_tab", arguments: { action: "close", targetId: "tab-1" } },
    });
    expect(closeRes?.id).toBe(34);
    expect(closeRes?.result?.content?.[0]?.text).toContain("Closed tab");

    // Self-correcting error on missing targetId for close
    const errRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 35,
      method: "tools/call",
      params: { name: "convo_tab", arguments: { action: "close" } },
    });
    expect(errRes?.id).toBe(35);
    expect(errRes?.result?.isError).toBe(true);
    expect(errRes?.result?.content?.[0]?.text).toContain("targetId is required for action 'close'");
  });

  it("handles tools/call for convo_search", async () => {
    const server = createTestServer();
    const res = await server.handleMessage({
      jsonrpc: "2.0",
      id: 36,
      method: "tools/call",
      params: { name: "convo_search", arguments: { query: "test" } },
    });
    expect(res?.id).toBe(36);
    expect(res?.result?.content?.[0]?.text).toContain("No results matching");
  });

  it("handles tools/call for convo_thread actions and errors", async () => {
    const server = createTestServer();
    const exportRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 37,
      method: "tools/call",
      params: { name: "convo_thread", arguments: { action: "export", threadId: "thread-1" } },
    });
    expect(exportRes?.id).toBe(37);
    expect(exportRes?.result?.content?.[0]?.text).toBeDefined();

    // Error on missing threadId
    const errRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 38,
      method: "tools/call",
      params: { name: "convo_thread", arguments: { action: "export" } },
    });
    expect(errRes?.id).toBe(38);
    expect(errRes?.result?.isError).toBe(true);
    expect(errRes?.result?.content?.[0]?.text).toContain("threadId is required for action 'export'");
  });

  it("handles tools/call for convo_profile list and select", async () => {
    const sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-mcp-profile-test-"));
    const server = createTestServer({ workDir: sandboxDir });
    const listRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 39,
      method: "tools/call",
      params: { name: "convo_profile", arguments: { action: "list" } },
    });
    expect(listRes?.id).toBe(39);
    expect(listRes?.result?.content?.[0]?.text).toContain("Discovered Browser Profiles:");

    const selectRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 40,
      method: "tools/call",
      params: { name: "convo_profile", arguments: { action: "select", target: "1" } },
    });
    expect(selectRes?.id).toBe(40);
    expect(selectRes?.result?.content?.[0]?.text).toBeDefined();

    // Verify custom write-in ('Other') path in select
    const customRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 41,
      method: "tools/call",
      params: { name: "convo_profile", arguments: { action: "select", target: "/custom/profile/dir" } },
    });
    expect(customRes?.id).toBe(41);
    expect(customRes?.result?.content?.[0]?.text).toContain("Saved custom active profile");

    // Clean up sandbox completely
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  });

  it("handles tools/call for convo_ask", async () => {
    const server = createTestServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "convo_ask",
        arguments: {
          prompt: "Write a hello world",
          platform: "deepseek",
        },
      },
    });

    expect(response?.id).toBe(4);
    const content = response?.result?.content;
    expect(content?.[0]?.type).toBe("text");
    expect(content?.[0]?.text).toContain("MCP Assistant reply");
    expect(response?.result?.writtenFiles).toBeDefined();
    expect(response?.result?.riskLabels).toBeDefined();
    expect(response?.result?.redactedSecretsCount).toBe(0);
  });

  it("returns an error for unknown tool calls", async () => {
    const server = createTestServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "non_existent_tool",
        arguments: {},
      },
    });

    expect(response?.id).toBe(5);
    expect(response?.result?.isError).toBe(true);
  });

  it("handles tools/call with missing or empty arguments safely", async () => {
    const server = createTestServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "convo_list_tabs",
      },
    });
    expect(response?.id).toBe(11);
    expect(response?.result?.content).toBeDefined();
  });

  const askWithOfflineTransport = async (
    tmpRoot: string,
    discoverProfiles?: () => Promise<import("../../src/adapters/browsers/browser-discovery.js").DiscoveredProfile[]>,
  ) => {
    const offlineBrowser = new FakeBrowserPort();
    offlineBrowser.health = async () => ({
      ok: false,
      adapterId: "fake",
      endpoint: "fake",
      openTabsCount: 0,
      latencyMs: 0,
    });

    const orchestrator = new SessionOrchestrator({
      browser: offlineBrowser,
      drivers: [new DeepSeekDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
    });

    const server = new McpServer({
      orchestrator,
      workDir: tmpRoot,
      ...(discoverProfiles ? { discoverProfiles } : {}),
    });
    return await server.handleMessage({
      jsonrpc: "2.0",
      id: 42,
      method: "tools/call",
      params: { name: "convo_ask", arguments: { prompt: "Hello" } },
    });
  };

  it("offers discovered profiles when transport is offline and no profile is configured", async () => {
    const tmpRoot = path.join(os.tmpdir(), `convo-empty-root-${Date.now()}`);
    fs.mkdirSync(tmpRoot, { recursive: true });

    try {
      const response = await askWithOfflineTransport(tmpRoot, async () => [
        { browser: "chrome", profileId: "Default", name: "Personal", email: "me@example.com", userDataDir: "/tmp/chrome" },
      ]);

      expect(response?.id).toBe(42);
      expect(response?.result?.isError).toBe(true);
      const text = response?.result?.content?.[0]?.text ?? "";
      expect(text).toContain("No browser profile configured");
      expect(text).toContain("convo_profile");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("asks for convo_setup when no profile is configured and none can be discovered", async () => {
    const tmpRoot = path.join(os.tmpdir(), `convo-empty-root-${Date.now()}`);
    fs.mkdirSync(tmpRoot, { recursive: true });

    try {
      const response = await askWithOfflineTransport(tmpRoot, async () => []);

      expect(response?.id).toBe(42);
      expect(response?.result?.isError).toBe(true);
      const text = response?.result?.content?.[0]?.text ?? "";
      expect(text).toContain("No browser profile is configured");
      expect(text).toContain("convo_setup");
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("runMcpServer processes JSON-RPC requests from input stream without echoing", async () => {
    const { Readable, Writable } = await import("node:stream");
    const { runMcpServer } = await import("../../src/entrypoints/mcp.js");

    const inputLines = [
      JSON.stringify({ jsonrpc: "2.0", id: 100, method: "ping" }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      "",
    ].join("\n");

    const inputStream = Readable.from([inputLines]);
    let outputData = "";
    const outputStream = new Writable({
      write(chunk, _encoding, callback) {
        outputData += chunk.toString();
        callback();
      },
    });

    const server = createTestServer();
    await runMcpServer(inputStream, outputStream, server);

    const lines = outputData.trim().split("\n");
    // Only 1 line of output expected: the ping response.
    // The notification must produce 0 lines, and the input line must NOT be echoed.
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.id).toBe(100);
    expect(parsed.result).toEqual({});
  });
});
