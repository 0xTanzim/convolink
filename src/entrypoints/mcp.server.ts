import type { SessionOrchestrator } from "../core/services/orchestrator.js";
import { MCP_TOOLS, executeMcpTool, type McpToolDefinition } from "./mcp.tools.js";

export interface McpServerInfo {
  readonly name: string;
  readonly version: string;
}

export interface McpCapabilities {
  readonly tools?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export interface McpContentItem {
  readonly type: string;
  readonly text: string;
}

export interface JsonRpcResult {
  readonly protocolVersion?: string;
  readonly serverInfo?: McpServerInfo;
  readonly capabilities?: McpCapabilities;
  readonly tools?: readonly McpToolDefinition[];
  readonly content?: readonly McpContentItem[];
  readonly isError?: boolean;
  readonly [key: string]: unknown;
}

export interface JsonRpcError {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface McpToolCallParams {
  readonly name?: string;
  readonly arguments?: Record<string, unknown>;
  readonly [key: string]: unknown;
}

export type JsonRpcParams = McpToolCallParams | Record<string, unknown> | unknown[];

export interface JsonRpcRequest {
  readonly jsonrpc: string;
  readonly id?: number | string | null;
  readonly method: string;
  readonly params?: JsonRpcParams;
}

export interface JsonRpcResponse {
  readonly jsonrpc: "2.0";
  readonly id?: number | string | null;
  readonly result?: JsonRpcResult;
  readonly error?: JsonRpcError;
}

export class McpServer {
  private readonly orchestrator: SessionOrchestrator;

  public constructor(orchestrator: SessionOrchestrator) {
    this.orchestrator = orchestrator;
  }

  public async handleMessage(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    // JSON-RPC 2.0 §4.1: Notifications have no id; server must not respond
    if (req.id === undefined || req.id === null) {
      return null;
    }

    switch (req.method) {
      case "initialize":
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            protocolVersion: "2024-11-05",
            serverInfo: { name: "convolink", version: "1.0.0" },
            capabilities: { tools: {} },
          },
        };

      case "tools/list":
        return { jsonrpc: "2.0", id: req.id, result: { tools: MCP_TOOLS } };

      case "tools/call": {
        const isObj = req.params && typeof req.params === "object" && !Array.isArray(req.params);
        const params = isObj ? (req.params as McpToolCallParams) : undefined;
        const name = typeof params?.name === "string" ? params.name : "";
        const toolArgs = params?.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments)
          ? params.arguments : {};
        const toolResult = await executeMcpTool(this.orchestrator, name, toolArgs);
        return {
          jsonrpc: "2.0",
          id: req.id,
          result: {
            content: [{ type: "text", text: toolResult.text }],
            isError: Boolean(toolResult.isError),
            ...(toolResult.writtenFiles !== undefined ? { writtenFiles: toolResult.writtenFiles } : {}),
            ...(toolResult.riskLabels !== undefined ? { riskLabels: toolResult.riskLabels } : {}),
            ...(toolResult.redactedSecretsCount !== undefined ? { redactedSecretsCount: toolResult.redactedSecretsCount } : {}),
          },
        };
      }

      case "ping":
        return { jsonrpc: "2.0", id: req.id, result: {} };

      default:
        return {
          jsonrpc: "2.0",
          id: req.id,
          error: { code: -32601, message: `Method not found: ${req.method}` },
        };
    }
  }
}
