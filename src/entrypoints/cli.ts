import { createContainer } from "../container.js";
import { parseAskArgs, parseCompareArgs, printHelp, readStdin } from "./cli.args.js";
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
} from "./cli.ops.js";

export async function runCli(args: string[]): Promise<number> {
  const command = args[0] || "doctor";
  const transportFlagIdx = args.indexOf("--transport");
  const transport = transportFlagIdx !== -1 ? (args[transportFlagIdx + 1] as BrowserAdapterId) : undefined;
  const container = createContainer({ transport });

  switch (command) {
    case "doctor":
      return handleDoctor(container.orchestrator, args.slice(1));
    case "list":
      return handleList(container.orchestrator);
    case "ask":
      return handleAsk(container.orchestrator, args.slice(1), transport);
    case "compare":
      return handleCompare(container.orchestrator, args.slice(1));
    case "tab":
      return handleTab(container.orchestrator, args.slice(1));
    case "back":
      await container.orchestrator.goBack(args[1]);
      console.log(`⬅️ Navigated back in browser history.`);
      return 0;
    case "undo":
      return handleUndo(container.orchestrator, args[1]);
    case "history":
      return handleHistory(container, args[1]);
    case "resume":
      return handleResume(container.orchestrator, args[1]);
    case "export":
      return handleExport(container.orchestrator, args.slice(1));
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
}

async function handleAsk(
  orchestrator: ReturnType<typeof createContainer>["orchestrator"],
  args: string[],
  transport?: BrowserAdapterId,
): Promise<number> {
  const parsed = parseAskArgs(args);
  let prompt = parsed.prompt || (await readStdin());

  if (!prompt.trim()) {
    console.error("Error: Prompt is required. Provide as arguments or pipe via stdin.");
    return 1;
  }

  try {
    const result = await orchestrator.ask({
      prompt,
      platform: parsed.platform,
      targetId: parsed.targetId,
      timeoutMs: parsed.timeoutMs,
      toggles: Object.keys(parsed.toggles).length > 0 ? parsed.toggles : undefined,
      writeFiles: parsed.writeFiles,
      outDir: parsed.outDir,
      autoContinue: parsed.autoContinue,
      newChat: parsed.newChat,
      openTab: parsed.openTab,
    });

    if (result.redactedSecretsCount > 0) {
      console.error(`🛡️ [PolicyGate] Redacted ${result.redactedSecretsCount} secret(s) from outbound prompt.`);
    }

    if (result.riskLabels.includes("contains_destructive_command")) {
      console.error("⚠️ [PolicyGate Warning] Inbound response contains potentially destructive shell command(s).");
    }

    console.log(result.turn.markdownContent);

    if (result.canvasDocument) {
      console.log(`\n🎨 [Canvas Document] ${result.canvasDocument.title}`);
    }

    if (result.writtenFiles && result.writtenFiles.length > 0) {
      console.log(`\n📁 Saved ${result.writtenFiles.length} artifact file(s):`);
      for (const f of result.writtenFiles) console.log(`  • ${f}`);
    }

    return 0;
  } catch (err: unknown) {
    console.error(`❌ Ask failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

async function handleCompare(orchestrator: ReturnType<typeof createContainer>["orchestrator"], args: string[]): Promise<number> {
  const parsed = parseCompareArgs(args);
  const prompt = parsed.prompt || (await readStdin());
  if (!prompt.trim()) {
    console.error("Error: Prompt is required for comparison.");
    return 1;
  }
  try {
    const report = await orchestrator.compare({
      prompt, platforms: parsed.platforms, mode: parsed.mode, timeoutMs: parsed.timeoutMs,
      outDir: parsed.outDir, arbitrate: parsed.arbitrate, arbiter: parsed.arbiter,
    });
    console.log(report.markdownReport);
    return 0;
  } catch (err: unknown) {
    console.error(`❌ Comparison failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
