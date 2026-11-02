import type { SessionOrchestrator } from "../core/services/orchestrator.js";
import { MCP_TOOLS, type McpToolDefinition } from "./mcp.schema.js";

export interface McpServerInfo { readonly name: string; readonly version: string; }
export interface McpCapabilities { readonly tools?: Record<string, unknown>; readonly [key: string]: unknown; }
export interface McpContentItem { readonly type: string; readonly text: string; }
export interface JsonRpcError { readonly code: number; readonly message: string; readonly data?: unknown; }
export interface McpToolCallParams { readonly name?: string; readonly arguments?: Record<string, unknown>; readonly [key: string]: unknown; }
export type JsonRpcParams = McpToolCallParams | Record<string, unknown> | unknown[];

export interface JsonRpcResult {
  readonly protocolVersion?: string;
  readonly serverInfo?: McpServerInfo;
  readonly capabilities?: McpCapabilities;
  readonly tools?: readonly McpToolDefinition[];
  readonly content?: readonly McpContentItem[];
  readonly isError?: boolean;
  readonly [key: string]: unknown;
}

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

export type OrchestratorProvider =
  | SessionOrchestrator
  | (() => Promise<SessionOrchestrator> | SessionOrchestrator);

export interface McpServerOptions {
  readonly orchestrator?: OrchestratorProvider;
  readonly onActivity?: () => void;
  readonly workDir?: string;
  /** Writes a JSON-RPC notification (progress) to the client. */
  readonly notify?: (message: unknown) => void;
}

export class McpServer {
  private readonly provider?: OrchestratorProvider;
  private readonly onActivity?: () => void;
  private readonly workDir?: string;
  private readonly notify?: (message: unknown) => void;
  private resolvedOrchestrator: SessionOrchestrator | null = null;

  public constructor(providerOrOptions?: OrchestratorProvider | McpServerOptions) {
    if (typeof providerOrOptions === "function" || (providerOrOptions && "ask" in providerOrOptions)) {
      this.provider = providerOrOptions as OrchestratorProvider;
    } else if (providerOrOptions && typeof providerOrOptions === "object") {
      this.provider = providerOrOptions.orchestrator;
      this.onActivity = providerOrOptions.onActivity;
      this.workDir = providerOrOptions.workDir;
      this.notify = providerOrOptions.notify;
    }
  }

  private async getOrchestrator(): Promise<SessionOrchestrator> {
    if (this.resolvedOrchestrator) return this.resolvedOrchestrator;
    if (!this.provider) throw new Error("McpServer: No orchestrator or orchestratorProvider configured");
    this.resolvedOrchestrator = typeof this.provider === "function" ? await this.provider() : this.provider;
    return this.resolvedOrchestrator;
  }

  public async handleMessage(req: JsonRpcRequest): Promise<JsonRpcResponse | null> {
    this.onActivity?.();
    if (req.id === undefined || req.id === null) return null;

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
        const orchestrator = await this.getOrchestrator();
        const { executeMcpTool } = await import("./mcp.tools.js");
        const progressToken = progressTokenOf(params);
        const toolResult = await executeMcpTool(orchestrator, name, toolArgs, {
          workDir: this.workDir,
          ...(progressToken !== undefined && this.notify
            ? { onProgress: this.progressPort(progressToken) }
            : {}),
        });
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

  public async shutdown(): Promise<void> {
    await this.resolvedOrchestrator?.shutdown().catch(() => {});
  }

  private progressPort(token: string | number) {
    let sequence = 0;
    return {
      report: (event: { stage: string; elapsedMs: number; platform?: string }) => {
        sequence += 1;
        this.notify?.({
          jsonrpc: "2.0",
          method: "notifications/progress",
          params: {
            progressToken: token,
            progress: sequence,
            message: `${event.platform ?? "browser"}:${event.stage}`,
          },
        });
      },
    };
  }
}

function progressTokenOf(params: McpToolCallParams | undefined): string | number | undefined {
  const meta = params?._meta;
  if (meta && typeof meta === "object" && "progressToken" in meta) {
    const token = (meta as { progressToken?: unknown }).progressToken;
    if (typeof token === "string" || typeof token === "number") return token;
  }
  return undefined;
}
