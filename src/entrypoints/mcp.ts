import readline from "node:readline";
import { createContainer } from "../container.js";
import { McpServer, type JsonRpcRequest } from "./mcp.server.js";

export async function runMcpServer(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
  server?: McpServer,
): Promise<void> {
  const mcpServer = server ?? new McpServer(createContainer().orchestrator);

  const rl = readline.createInterface({
    input,
    terminal: false,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const request = JSON.parse(trimmed) as JsonRpcRequest;
      const response = await mcpServer.handleMessage(request);
      if (response) {
        output.write(JSON.stringify(response) + "\n");
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
      output.write(JSON.stringify(errorResponse) + "\n");
    }
  }
}

if (import.meta.main) {
  await runMcpServer();
}
