import { createContainer } from "../container.js";
import type { PlatformId, ToggleOptions } from "../core/ports/platform.port.js";

export async function runCli(args: string[]): Promise<number> {
  const command = args[0] || "doctor";
  const container = createContainer();

  switch (command) {
    case "doctor":
      return handleDoctor(container.orchestrator);
    case "list":
      return handleList(container.orchestrator);
    case "ask":
      return handleAsk(container.orchestrator, args.slice(1));
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

async function handleDoctor(orchestrator: ReturnType<typeof createContainer>["orchestrator"]): Promise<number> {
  console.log("🔍 Running ConvoLink Doctor...\n");
  try {
    const report = await orchestrator.doctor();
    console.log(`[CDP Transport] Status: ${report.transportHealth.ok ? "ONLINE" : "OFFLINE"} (Latency: ${report.transportHealth.latencyMs}ms)`);
    console.log(`[Tabs] Found ${report.totalTabs} total open tab(s), ${report.supportedTabs} supported AI tab(s).\n`);

    for (const tab of report.tabs) {
      const platformBadge = tab.platformId ? `[${tab.platformId.toUpperCase()}]` : "[UNSUPPORTED]";
      const statusBadge = tab.selectorsOk ? "✅ READY" : (tab.platformId ? "⚠️ SELECTOR MISMATCH" : "⚪ IGNORED");
      const lockBadge = tab.isLocked ? "🔒 LOCKED" : "🔓 UNLOCKED";

      console.log(`• ${platformBadge} ${tab.title}`);
      console.log(`  TargetId: ${tab.targetId} | ${statusBadge} | ${lockBadge}`);
      console.log(`  URL: ${tab.url}`);
      if (tab.layoutVariant) console.log(`  Layout: ${tab.layoutVariant}`);
      if (tab.error) console.log(`  Error: ${tab.error}`);
      console.log("");
    }

    return report.supportedTabs > 0 ? 0 : 1;
  } catch (err: unknown) {
    console.error(`❌ Doctor diagnostic failed: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}

async function handleList(orchestrator: ReturnType<typeof createContainer>["orchestrator"]): Promise<number> {
  const tabs = await orchestrator.listTabs();
  console.log(`Open Tabs (${tabs.length}):`);
  for (const t of tabs) {
    const platform = t.platformId ?? "unsupported";
    console.log(`[${t.targetId}] [${platform}] ${t.title} (${t.url})`);
  }
  return 0;
}

interface ParsedAskArgs {
  prompt: string;
  platform?: PlatformId;
  targetId?: string;
  timeoutMs?: number;
  toggles: ToggleOptions;
  writeFiles?: boolean;
  outDir?: string;
  autoContinue?: boolean;
}

function parseAskArgs(args: string[]): ParsedAskArgs {
  let prompt = "", platform: PlatformId | undefined, targetId: string | undefined, timeoutMs: number | undefined;
  let think: boolean | undefined, search: boolean | undefined, writeFiles: boolean | undefined;
  let outDir: string | undefined, autoContinue: boolean | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--platform" && i + 1 < args.length) platform = args[++i] as PlatformId;
    else if (a === "--target" && i + 1 < args.length) targetId = args[++i];
    else if (a === "--timeout" && i + 1 < args.length) timeoutMs = Number(args[++i]);
    else if (a === "--out-dir" && i + 1 < args.length) outDir = args[++i];
    else if (a === "-w" || a === "--write-files") writeFiles = true;
    else if (a === "--no-continue") autoContinue = false;
    else if (a === "--think") think = true;
    else if (a === "--no-think") think = false;
    else if (a === "--search") search = true;
    else if (a === "--no-search") search = false;
    else if (!a.startsWith("-")) prompt = prompt ? `${prompt} ${a}` : a;
  }

  const toggles: ToggleOptions = { ...(think !== undefined ? { think } : {}), ...(search !== undefined ? { search } : {}) };
  return { prompt, platform, targetId, timeoutMs, toggles, writeFiles, outDir, autoContinue };
}

async function handleAsk(
  orchestrator: ReturnType<typeof createContainer>["orchestrator"],
  args: string[],
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

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    data += chunk;
  }
  return data.trim();
}

function printHelp(): void {
  console.log(`ConvoLink CLI (convo)
Usage:
  convo doctor                 Check CDP connection, open tabs, and selector health
  convo list                   List all currently open browser tabs
  convo ask "Your question"     Send prompt to active browser session and stream reply

Options for ask:
  --platform <id>             Target specific platform (deepseek | chatgpt | gemini)
  --target <targetId>         Target specific browser tab targetId
  --think / --no-think        Enable or disable deep thinking mode
  --search / --no-search      Enable or disable web search mode
  --timeout <ms>              Response wait timeout in milliseconds (default: 120000)
  --write-files, -w           Extract and save code blocks to local workspace
  --out-dir <path>            Output directory for saved artifacts (default: ./artifacts)
  --no-continue               Disable automated stream continuation
`);
}
