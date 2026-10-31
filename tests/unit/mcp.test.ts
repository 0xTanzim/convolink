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
    expect(response?.result.protocolVersion).toBe("2024-11-05");
    expect(response?.result.serverInfo.name).toBe("convolink");
    expect(response?.result.capabilities.tools).toBeDefined();
  });

  it("handles tools/list and returns available cognitive browser tools", async () => {
    const server = createTestServer();
    const response = await server.handleMessage({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });

    expect(response?.id).toBe(2);
    const tools = response?.result.tools as Array<{ name: string; description: string }>;
    expect(tools.length).toBeGreaterThanOrEqual(4);
    expect(tools.some((t) => t.name === "convo_ask")).toBe(true);
    expect(tools.some((t) => t.name === "convo_compare")).toBe(true);
    expect(tools.some((t) => t.name === "convo_list_tabs")).toBe(true);
    expect(tools.some((t) => t.name === "convo_tab_new")).toBe(true);
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
    const content = response?.result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.type).toBe("text");
    expect(content[0]?.text).toContain("DeepSeek");
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
    const content = response?.result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("MCP Assistant reply");
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
    expect(response?.result.isError).toBe(true);
  });
});
