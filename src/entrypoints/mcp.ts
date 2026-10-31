import readline from "node:readline";
import { createContainer } from "../container.js";
import { McpServer, type JsonRpcRequest } from "./mcp.server.js";

export async function runMcpServer(): Promise<void> {
  const container = createContainer();
  const server = new McpServer(container.orchestrator);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const request = JSON.parse(trimmed) as JsonRpcRequest;
      const response = await server.handleMessage(request);
      if (response) {
        process.stdout.write(JSON.stringify(response) + "\n");
      }
    } catch (err: unknown) {
      const errorResponse = {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error",
          data: err instanceof Error ? err.message : String(err),
        },
      };
      process.stdout.write(JSON.stringify(errorResponse) + "\n");
    }
  }
}

if (import.meta.main) {
  await runMcpServer();
}
