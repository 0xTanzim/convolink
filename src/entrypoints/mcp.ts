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
  let mcpServer: McpServer | undefined = server;
  const cleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await mcpServer?.shutdown();
    LockService.cleanupProcessLocks();
  };

  const idleController = new IdleTimeoutController({
    timeoutMs,
    onTimeout: () => {
      void cleanup();
      if (options.exitOnTimeout !== false && input === process.stdin) {
        process.exit(0);
      }
    },
  });

  const unregisterTeardown = registerTeardownHandlers(() => {
    idleController.stop();
    void cleanup();
  });

  mcpServer = server ?? new McpServer({
    orchestrator: async () => {
      // Delegate to the daemon when it is running: it owns the extension
      // bridge port, so a second adapter here would fail to bind.
      const { createMcpOrchestrator } = await import("./mcp.orchestrator.js");
      return createMcpOrchestrator();
    },
    onActivity: () => idleController.recordActivity(),
    notify: (message) => output.write(JSON.stringify(message) + "\n"),
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
    await cleanup();
    unregisterTeardown();
  }
}

if (import.meta.main) {
  await runMcpServer();
}
