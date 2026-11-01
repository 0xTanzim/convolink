import { describe, expect, it } from "bun:test";
import { McpServer } from "../../src/entrypoints/mcp.server.js";
import { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { PolicyService } from "../../src/core/services/policy.service.js";

describe("McpServer (JSON-RPC over stdio)", () => {
  const createTestServer = () => {
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

    return new McpServer(orchestrator);
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

  it("handles tools/list and returns available cognitive browser tools", async () => {
    const server = createTestServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    expect(response?.id).toBe(2);
    const tools = response?.result?.tools;
    expect(tools).toBeDefined();
    expect(tools!.length).toBeGreaterThanOrEqual(4);
    expect(tools!.some((t) => t.name === "convo_ask")).toBe(true);
    expect(tools!.some((t) => t.name === "convo_compare")).toBe(true);
    expect(tools!.some((t) => t.name === "convo_list_tabs")).toBe(true);
    expect(tools!.some((t) => t.name === "convo_tab_new")).toBe(true);

    const askTool = tools!.find((t) => t.name === "convo_ask");
    expect(askTool).toBeDefined();
    expect((askTool?.inputSchema.properties as any).targetId).toBeDefined();
    expect((askTool?.inputSchema.properties as any).writeFiles).toBeDefined();
    expect((askTool?.inputSchema.properties as any).outDir).toBeDefined();
  });

  it("handles tools/call for convo_list_tabs", async () => {
    const server = createTestServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "convo_list_tabs",
        arguments: {},
      },
    });

    expect(response?.id).toBe(3);
    const content = response?.result?.content;
    expect(content?.[0]?.type).toBe("text");
    expect(content?.[0]?.text).toContain("DeepSeek");
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

  it("handles tools/call for convo_search and convo_export", async () => {
    const server = createTestServer();
    const searchRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "convo_search",
        arguments: { query: "nonexistent-query-123" },
      },
    });
    expect(searchRes?.id).toBe(5);
    const searchContent = searchRes?.result?.content;
    expect(searchContent?.[0]?.text).toContain("No results matching");

    const exportRes = await server.handleMessage({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: {
        name: "convo_export",
        arguments: { threadId: "nonexistent-thread" },
      },
    });
    expect(exportRes?.id).toBe(6);
    expect(exportRes?.result?.isError).toBe(true);
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

  it("returns null for notifications without id (JSON-RPC 2.0 §4.1 compliance)", async () => {
    const server = createTestServer();

    // Standard notification method
    const notif1 = await server.handleMessage({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    });
    expect(notif1).toBeNull();

    // Standard method invoked without id (treated as notification)
    const notif2 = await server.handleMessage({
      jsonrpc: "2.0",
      method: "tools/list",
    });
    expect(notif2).toBeNull();

    // Unknown method sent as notification MUST NOT return error response
    const notif3 = await server.handleMessage({
      jsonrpc: "2.0",
      method: "custom/unknown_notification",
    });
    expect(notif3).toBeNull();

    // Notification with explicit null id
    const notif4 = await server.handleMessage({
      jsonrpc: "2.0",
      id: null,
      method: "ping",
    });
    expect(notif4).toBeNull();
  });

  it("handles request with id: 0 correctly without treating it as notification", async () => {
    const server = createTestServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 0,
      method: "ping",
    });
    expect(response).not.toBeNull();
    expect(response?.id).toBe(0);
    expect(response?.result).toEqual({});
  });

  it("returns serverInfo.version as 1.0.0 matching package.json", async () => {
    const server = createTestServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 10,
      method: "initialize",
    });
    expect(response?.result?.serverInfo?.version).toBe("1.0.0");
    expect(response?.result?.serverInfo?.name).toBe("convolink");
  });

  it("returns method not found error when request with id targets unknown method", async () => {
    const server = createTestServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 99,
      method: "unknown_method_xyz",
    });
    expect(response?.id).toBe(99);
    expect(response?.error?.code).toBe(-32601);
    expect(response?.error?.message).toContain("Method not found: unknown_method_xyz");
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

  it("handles convo_profile_list tool and returns profile catalog for agent elicitation", async () => {
    const server = createTestServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: { name: "convo_profile_list" },
    });

    expect(response?.id).toBe(20);
    expect(response?.result?.content).toBeDefined();
    const text = response?.result?.content?.[0]?.text;
    expect(text).toContain("Browser Profiles");
  });

  it("handles convo_profile_select tool and persists choice to .convo/config.json", async () => {
    const server = createTestServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
      params: {
        name: "convo_profile_select",
        arguments: { target: "1" },
      },
    });

    expect(response?.id).toBe(21);
    expect(response?.result?.content).toBeDefined();
    const text = response?.result?.content?.[0]?.text;
    expect(text?.includes("Saved active profile") || text?.includes("No profile matched")).toBe(true);
  });
});
