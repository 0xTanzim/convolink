import { describe, expect, it } from "bun:test";
import { executeMcpTool } from "../../src/entrypoints/mcp.tools.js";
import { runMcpServer } from "../../src/entrypoints/mcp.js";
import { McpServer } from "../../src/entrypoints/mcp.server.js";
import { DaemonClient } from "../../src/adapters/daemon/daemon-client.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { ChatGPTDriver } from "../../src/adapters/platforms/chatgpt.driver.js";
import { ClaudeDriver } from "../../src/adapters/platforms/claude.driver.js";
import { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { PolicyService } from "../../src/core/services/policy.service.js";
import * as net from "node:net";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

describe("Phase 2: Protocol Resilience & Context Economy", () => {
  const browser = new FakeBrowserPort();
  const orchestrator = new SessionOrchestrator({
    browser,
    drivers: [new ChatGPTDriver(), new ClaudeDriver()],
    lockService: new LockService(),
    policyGate: new PolicyService(),
  });

  it("convo_ask: validates and rejects empty/whitespace prompts upfront with structured error", async () => {
    const resEmpty = await executeMcpTool(orchestrator, "convo_ask", { prompt: "" });
    expect(resEmpty.isError).toBe(true);
    expect(resEmpty.structured?.error).toBeDefined();
    expect((resEmpty.structured?.error as any).code).toBe("invalid-argument");

    const resWhitespace = await executeMcpTool(orchestrator, "convo_ask", { prompt: "   \n\t  " });
    expect(resWhitespace.isError).toBe(true);
    expect(resWhitespace.structured?.error).toBeDefined();
    expect((resWhitespace.structured?.error as any).code).toBe("invalid-argument");
  });

  it("convo_compare: validates and rejects empty prompts upfront with structured error", async () => {
    const res = await executeMcpTool(orchestrator, "convo_compare", { prompt: "   " });
    expect(res.isError).toBe(true);
    expect(res.structured?.error).toBeDefined();
    expect((res.structured?.error as any).code).toBe("invalid-argument");
  });

  it("convo_tab & convo_thread: wrap early error returns with structured error envelope", async () => {
    const resTabClose = await executeMcpTool(orchestrator, "convo_tab", { action: "close" });
    expect(resTabClose.isError).toBe(true);
    expect(resTabClose.structured?.error).toBeDefined();
    expect((resTabClose.structured?.error as any).code).toBe("invalid-argument");

    const resTabInvalid = await executeMcpTool(orchestrator, "convo_tab", { action: "nonexistent" });
    expect(resTabInvalid.isError).toBe(true);
    expect(resTabInvalid.structured?.error).toBeDefined();

    const resThreadExport = await executeMcpTool(orchestrator, "convo_thread", { action: "export" });
    expect(resThreadExport.isError).toBe(true);
    expect(resThreadExport.structured?.error).toBeDefined();

    const resUnknown = await executeMcpTool(orchestrator, "invalid_tool_name", {});
    expect(resUnknown.isError).toBe(true);
    expect(resUnknown.structured?.error).toBeDefined();
    expect((resUnknown.structured?.error as any).code).toBe("unknown-tool");
  });

  it("convo_doctor: filters browser tabs to supported AI platforms to economize agent context", async () => {
    browser.listTabs = async () => [
      { targetId: "tab-1", title: "ChatGPT", url: "https://chatgpt.com/" },
      { targetId: "tab-2", title: "Personal Gmail", url: "https://mail.google.com/" },
      { targetId: "tab-3", title: "YouTube", url: "https://youtube.com/" },
      { targetId: "tab-4", title: "Claude Chat", url: "https://claude.ai/new" },
    ];

    const res = await executeMcpTool(orchestrator, "convo_doctor", {});
    expect(res.structured).toBeDefined();
    const tabs = res.structured?.tabs as any[];
    expect(tabs).toBeDefined();
    // Only the 2 supported AI platforms (ChatGPT and Claude) should be in the report
    expect(tabs.length).toBe(2);
    expect(tabs.some((t) => t.targetId === "tab-1")).toBe(true);
    expect(tabs.some((t) => t.targetId === "tab-4")).toBe(true);
    expect(tabs.some((t) => t.targetId === "tab-2")).toBe(false);
  });

  it("runMcpServer: preserves request id on internal server error (-32603)", async () => {
    const { Readable, Writable } = await import("node:stream");
    const inputLines = [
      JSON.stringify({ jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "convo_ask" } }),
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

    const faultyServer = new McpServer({
      orchestrator: () => {
        throw new Error("Simulated internal crash");
      },
    });

    await runMcpServer(inputStream, outputStream, faultyServer, { exitOnTimeout: false });

    const response = JSON.parse(outputData.trim());
    expect(response.id).toBe(42);
    expect(response.error.code).toBe(-32603);
    expect(response.error.message).toBe("Internal error");
  });

  it("DaemonClient: rejects immediately if socket closes prematurely before sending newline", async () => {
    const sockPath = path.join(os.tmpdir(), `test-daemon-client-${Date.now()}.sock`);
    const server = net.createServer((sock) => {
      // Abruptly destroy or close without newline
      sock.destroy();
    });
    await new Promise<void>((resolve) => server.listen(sockPath, resolve));

    try {
      const client = new DaemonClient({ socketPath: sockPath });
      await expect(client.sendRequest("ping" as any, undefined, 5000)).rejects.toThrow(/closed|epipe/i);
    } finally {
      server.close();
    }
  });
});
