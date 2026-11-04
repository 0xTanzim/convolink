import type { SessionOrchestrator } from "../core/services/orchestrator.js";
import { toConvoError } from "../core/errors/convo-error.js";
import { handleAsk, handleCompare } from "./mcp.tools.ask.js";
import { handleListTabs, handleTab, handleSearch, handleThread } from "./mcp.tools.tabs.js";
import { handleStatus, handleSetup, handleOnboard, handleDoctor, handleProfile } from "./mcp.tools.diagnostics.js";
import {
  NEXT_TOOL_HINTS,
  type ExecuteToolOptions,
  type McpToolExecutionResult,
} from "./mcp.tools.types.js";

export { MCP_TOOLS, type McpToolDefinition } from "./mcp.schema.js";
export * from "./mcp.tools.types.js";

export async function executeMcpTool(
  orchestrator: SessionOrchestrator,
  name: string,
  args: Record<string, unknown> = {},
  options?: ExecuteToolOptions,
): Promise<McpToolExecutionResult> {
  const workspaceRoot =
    typeof args.workspaceRoot === "string" && args.workspaceRoot.trim() ? args.workspaceRoot.trim() : undefined;
  const workDir = workspaceRoot ?? options?.workDir;
  try {
    switch (name) {
      case "convo_ask":
        return await handleAsk(orchestrator, args, workDir, options);
      case "convo_compare":
        return await handleCompare(orchestrator, args, workDir, options);
      case "convo_status":
        return await handleStatus(workDir);
      case "convo_setup":
        return await handleSetup(args, workDir, options);
      case "convo_onboard":
        return await handleOnboard(options);
      case "convo_doctor":
        return await handleDoctor(orchestrator, args, workDir);
      case "convo_list_tabs":
        return await handleListTabs(orchestrator);
      case "convo_tab":
        return await handleTab(orchestrator, args);
      case "convo_search":
        return await handleSearch(orchestrator, args);
      case "convo_thread":
        return await handleThread(orchestrator, args);
      case "convo_profile":
        return await handleProfile(args, workDir);
      default:
        return {
          text: `Unknown tool: ${name}. Call tools/list to inspect valid tools.`,
          isError: true,
          structured: {
            error: {
              code: "unknown-tool",
              message: `Unknown tool: ${name}. Call tools/list to inspect valid tools.`,
            },
          },
        };
    }
  } catch (err: unknown) {
    const error = toConvoError(err);
    const nextToolHint = NEXT_TOOL_HINTS[error.code];
    return {
      text: `[${error.code}] ${error.message} — ${error.remediation}`,
      isError: true,
      structured: {
        error: {
          code: error.code,
          message: error.message,
          remediation: error.remediation,
          retryable: error.retryable,
          ...(nextToolHint ? { nextTool: nextToolHint.tool, nextArgs: nextToolHint.args } : {}),
        },
      },
    };
  }
}
