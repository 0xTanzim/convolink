import type { SessionOrchestrator } from "../core/services/orchestrator.js";
import { MCP_TOOLS, executeMcpTool } from "./mcp.tools.js";

export interface JsonRpcRequest {
  jsonrpc: string;
  id?: number | string;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class McpServer {
  private readonly orchestrator: SessionOrchestrator;

  constructor(orchestrator: SessionOrchestrator) {
    this.orchestrator = orchestrator;
  }

  public async handleMessage(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    if (!req.id && req.method?.startsWith("notifications/")) {
      return null;
    }

    switch (req.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "convolink", version: "0.2.0" },
            capabilities: { tools: {} },
          },
        };

      case "tools/list":
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            tools: MCP_TOOLS,
          },
        };

      case "tools/call": {
        const { name, arguments: toolArgs } = req.params || {};
        const toolResult = await executeMcpTool(this.orchestrator, name, toolArgs);
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            content: [{ type: "text", text: toolResult.text }],
            isError: Boolean(toolResult.isError),
          },
        };
      }

      case "ping":
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {},
        };

      default:
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: {
            code: -32601,
            message: `Method not found: ${req.method}`,
          },
        };
    }
  }
}
