import readline from "node:readline";
import { LockService } from "../core/services/lock.service.js";
import { McpServer, type JsonRpcRequest } from "./mcp.server.js";
import { parseDurationMs, IdleTimeoutController, registerTeardownHandlers } from "./mcp.lifecycle.js";

export interface RunMcpServerOptions {
  readonly args?: readonly string[];
  readonly exitOnTimeout?: boolean;
}

export function parseIdleTimeout(args: readonly string[] = process.argv.slice(2)): number {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--idle-timeout=")) {
      return parseDurationMs(arg.slice("--idle-timeout=".length));
    }
    if (arg === "--idle-timeout" && i + 1 < args.length) {
      return parseDurationMs(args[i + 1]!);
    }
  }
  return parseDurationMs("15m");
}

export async function runMcpServer(
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
  server?: McpServer,
  options: RunMcpServerOptions = {},
): Promise<void> {
  const timeoutMs = parseIdleTimeout(options.args ?? process.argv.slice(2));
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    LockService.cleanupProcessLocks();
  };

  const idleController = new IdleTimeoutController({
    timeoutMs,
    onTimeout: () => {
      cleanup();
      if (options.exitOnTimeout !== false && input === process.stdin) {
        process.exit(0);
      }
    },
  });

  const unregisterTeardown = registerTeardownHandlers(() => {
    idleController.stop();
    cleanup();
  });

  const mcpServer = server ?? new McpServer({
    orchestrator: async () => (await import("../container.js")).createContainer().orchestrator,
    onActivity: () => idleController.recordActivity(),
  });

  const rl = readline.createInterface({ input, terminal: false });

  try {
    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      idleController.recordActivity();

      try {
        const request = JSON.parse(trimmed) as JsonRpcRequest;
        const response = await mcpServer.handleMessage(request);
        if (response) output.write(JSON.stringify(response) + "\n");
      } catch (err: unknown) {
        const errorResponse = {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error", data: err instanceof Error ? err.message : String(err) },
        };
        output.write(JSON.stringify(errorResponse) + "\n");
      }
    }
  } finally {
    idleController.stop();
    cleanup();
    unregisterTeardown();
  }
}

if (import.meta.main) {
  await runMcpServer();
}
