import { createContainer } from "../container.js";
import { printHelp, parseAskArgs, parseCompareArgs, readStdin } from "./cli.args.js";
import { runMcpServer } from "./mcp.js";
import { handleFirefoxConnect } from "./cli.firefox.js";
import { handleSetup } from "./cli.setup.command.js";
import { ensureConfigured } from "./cli.setup.js";
import { loadResolution } from "./config-context.js";
import { hasJsonFlag, printError } from "./cli.output.js";
import type { BrowserId, TransportId } from "../core/ports/config.port.js";
import {
  handleDoctor,
  handleList,
  handleTab,
  handleUndo,
  handleHistory,
  handleResume,
  handleExport,
  handleSearch,
  handleClean,
  handleProfile,
} from "./cli.ops.js";
import { handleExt } from "./cli.ext.js";
import { handleDaemon } from "./cli.daemon.js";
import { handleAsk, handleCompare } from "./cli.query.js";

const BROWSER_COMMANDS = new Set(["list", "ask", "compare", "tab"]);

export async function runCli(args: string[]): Promise<number> {
  const command = args[0] || "doctor";
  const json = hasJsonFlag(args);

  if (command === "setup") return await handleSetup(args.slice(1));
  if (command === "mcp" || command === "profile" || command === "clean" || command === "ext" || command === "daemon") {
    return await dispatch(command, undefined, args);
  }

  if (command === "ask" || command === "compare") {
    // Resolve the prompt before the setup gate: a missing prompt is a caller
    // error and must not be reported as a configuration problem.
    const parsedPrompt = command === "ask" ? parseAskArgs(args.slice(1)).prompt : parseCompareArgs(args.slice(1)).prompt;
    const prompt = parsedPrompt.trim() ? parsedPrompt : await readStdin();
    if (!prompt.trim()) {
      console.error(`❌ Prompt is required for ${command === "ask" ? "ask" : "comparison"}.`);
      console.error("   → Pass the prompt as an argument or pipe it via stdin.");
      return 6;
    }
    if (!parsedPrompt.trim()) args = [...args, prompt];
  }

  try {
    if (command === "history" || command === "search") {
      const container = createContainer();
      try {
        return await dispatch(command, container, args);
      } finally {
        await container.shutdown();
      }
    }

    const browserId = flagValue(args, "--browser") ?? flagValue(args, "-b");
    const profilePath = flagValue(args, "--profile");
    const transport = flagValue(args, "--transport");

    const lenient = command === "doctor";
    const resolution = lenient
      ? await loadResolution().then((result) => (result.ok ? result.value : undefined))
      : BROWSER_COMMANDS.has(command)
      ? await ensureConfigured({
          ...(browserId ? { browserId: browserId as BrowserId } : {}),
          ...(profilePath ? { profilePath } : {}),
          ...(transport ? { transport: transport as TransportId } : {}),
        })
      : undefined;

    if (resolution && (command === "ask" || command === "compare" || command === "list" || command === "tab")) {
      await assertDaemonMatches(resolution);
    }
    const container = createContainer({ ...(resolution ? { resolution } : {}) });
    try {
      return await dispatch(command, container, args, { json });
    } finally {
      await container.shutdown();
    }
  } catch (error) {
    return printError(error);
  }
}

/**
 * A daemon started for Chrome cannot serve a project that switched to Firefox.
 * Saying so beats a silent hang or a transport error from the wrong endpoint.
 */
async function assertDaemonMatches(resolution: { transport: string }): Promise<void> {
  const { DaemonClient } = await import("../adapters/daemon/daemon-client.js");
  const { readDaemonStatus } = await import("./daemon-status.js");
  if (!(await new DaemonClient().isAlive())) return;

  const status = readDaemonStatus();
  if (status && status.transport !== resolution.transport) {
    const { ConvoError } = await import("../core/errors/convo-error.js");
    throw new ConvoError(
      "transport-mismatch",
      `The running daemon uses ${status.transport}, but this project is configured for ${resolution.transport}.`,
      "Run `convo daemon stop` and start it again, or stop using the daemon for this project.",
    );
  }
}

function flagValue(args: readonly string[], flag: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : undefined;
}

async function dispatch(
  command: string,
  container: ReturnType<typeof createContainer> | undefined,
  args: string[],
  flags: { json: boolean } = { json: false },
): Promise<number> {
  if (!container) {
    switch (command) {
      case "mcp":
        await runMcpServer();
        return 0;
      case "connect":
        return await handleFirefoxConnect(args.slice(1));
      case "clean":
        return await handleClean();
      case "profile":
        return await handleProfile(args.slice(1));
      case "ext":
        return await handleExt(args.slice(1));
      case "daemon":
        return await handleDaemon(args.slice(1));
      default:
        return await dispatchWithHelp(command);
    }
  }

  switch (command) {
    case "doctor":
      return await handleDoctor(container.orchestrator, args.slice(1), flags);
    case "list":
      return await handleList(container.orchestrator, flags);
    case "ask":
      return await handleAsk(container.orchestrator, args.slice(1), flags);
    case "compare":
      return await handleCompare(container.orchestrator, args.slice(1), flags);
    case "tab":
      return await handleTab(container.orchestrator, args.slice(1), flags);
    case "back":
      await container.orchestrator.goBack(args[1]);
      if (!flags.json) console.log(`⬅️ Navigated back in browser history.`);
      return 0;
    case "undo":
      return await handleUndo(container.orchestrator, args[1]);
    case "history":
      return await handleHistory(container, args[1]);
    case "resume":
      return await handleResume(container.orchestrator, args[1]);
    case "export":
      return await handleExport(container.orchestrator, args.slice(1));
    case "search":
      return await handleSearch(container.orchestrator, args.slice(1).join(" "));
    case "connect":
      return await handleFirefoxConnect(args.slice(1));
    case "clean":
      return await handleClean();
    case "profile":
      return await handleProfile(args.slice(1));
    case "ext":
      return await handleExt(args.slice(1));
    case "daemon":
      return await handleDaemon(args.slice(1));
    default:
      return await dispatchWithHelp(command);
  }
}

async function dispatchWithHelp(command: string): Promise<number> {
  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return 0;
  }
  console.error(`Unknown command: ${command}`);
  printHelp();
  return 1;
}

if (import.meta.main) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}
