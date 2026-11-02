import { createContainer } from "../container.js";
import { printHelp } from "./cli.args.js";
import { runMcpServer } from "./mcp.js";
import type { BrowserAdapterId } from "../core/ports/browser.port.js";
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

export async function runCli(args: string[]): Promise<number> {
  const command = args[0] || "doctor";
  const transportFlagIdx = args.indexOf("--transport");
  const transport = transportFlagIdx !== -1 ? (args[transportFlagIdx + 1] as BrowserAdapterId) : undefined;
  const browserFlagIdx = args.indexOf("--browser") !== -1 ? args.indexOf("--browser") : args.indexOf("-b");
  const browserName = browserFlagIdx !== -1 ? args[browserFlagIdx + 1] : undefined;
  const container = createContainer({ transport, browserName });

  try {
    switch (command) {
      case "doctor":
        return await handleDoctor(container.orchestrator, args.slice(1));
      case "list":
        return await handleList(container.orchestrator);
      case "ask":
        return await handleAsk(container.orchestrator, args.slice(1), transport);
      case "compare":
        return await handleCompare(container.orchestrator, args.slice(1));
      case "tab":
        return await handleTab(container.orchestrator, args.slice(1));
      case "back":
        await container.orchestrator.goBack(args[1]);
        console.log(`⬅️ Navigated back in browser history.`);
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
      case "clean":
        return await handleClean();
      case "profile":
        return await handleProfile(args.slice(1));
      case "ext":
        return await handleExt(args.slice(1));
      case "daemon":
        return await handleDaemon(args.slice(1));
      case "mcp":
        await runMcpServer();
        return 0;
      case "help":
      case "--help":
      case "-h":
        printHelp();
        return 0;
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        return 1;
    }
  } finally {
    try {
      await container.browser.disconnect?.();
    } catch {}
  }
}

if (import.meta.main) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}
