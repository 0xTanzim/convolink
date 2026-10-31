import type { PlatformId, ToggleOptions } from "../core/ports/platform.port.js";
import type { BrowserAdapterId } from "../core/ports/browser.port.js";

export interface ParsedAskArgs {
  prompt: string;
  platform?: PlatformId;
  targetId?: string;
  timeoutMs?: number;
  toggles: ToggleOptions;
  writeFiles?: boolean;
  outDir?: string;
  autoContinue?: boolean;
  newChat?: boolean;
  openTab?: boolean;
  transport?: BrowserAdapterId;
}

export function parseAskArgs(args: string[]): ParsedAskArgs {
  let prompt = "", platform: PlatformId | undefined, targetId: string | undefined, timeoutMs: number | undefined;
  let think: boolean | undefined, search: boolean | undefined, writeFiles: boolean | undefined;
  let outDir: string | undefined, autoContinue: boolean | undefined;
  let newChat = false, openTab = false;
  let transport: BrowserAdapterId | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--platform" && i + 1 < args.length) platform = args[++i] as PlatformId;
    else if (a === "--target" && i + 1 < args.length) targetId = args[++i];
    else if (a === "--timeout" && i + 1 < args.length) timeoutMs = Number(args[++i]);
    else if (a === "--out-dir" && i + 1 < args.length) outDir = args[++i];
    else if (a === "--transport" && i + 1 < args.length) transport = args[++i] as BrowserAdapterId;
    else if (a === "-w" || a === "--write-files") writeFiles = true;
    else if (a === "--no-continue") autoContinue = false;
    else if (a === "--think") think = true;
    else if (a === "--no-think") think = false;
    else if (a === "--search") search = true;
    else if (a === "--no-search") search = false;
    else if (a === "--new" || a === "-n") newChat = true;
    else if (a === "--open-tab") openTab = true;
    else if (!a.startsWith("-")) prompt = prompt ? `${prompt} ${a}` : a;
  }

  const toggles: ToggleOptions = { ...(think !== undefined ? { think } : {}), ...(search !== undefined ? { search } : {}) };
  return { prompt, platform, targetId, timeoutMs, toggles, writeFiles, outDir, autoContinue, newChat, openTab, transport };
}

export interface ParsedCompareArgs {
  prompt: string;
  platforms?: PlatformId[];
  timeoutMs?: number;
  mode?: "parallel" | "sequential";
  outDir?: string;
  transport?: BrowserAdapterId;
  arbitrate?: boolean;
  arbiter?: PlatformId;
}

export function parseCompareArgs(args: string[]): ParsedCompareArgs {
  let prompt = "", timeoutMs: number | undefined, outDir: string | undefined;
  let mode: "parallel" | "sequential" | undefined;
  let platforms: PlatformId[] | undefined;
  let transport: BrowserAdapterId | undefined;
  let arbitrate: boolean | undefined;
  let arbiter: PlatformId | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--platforms" && i + 1 < args.length) {
      platforms = args[++i]!.split(",").map((p) => p.trim()) as PlatformId[];
    } else if (a === "--timeout" && i + 1 < args.length) {
      timeoutMs = Number(args[++i]);
    } else if (a === "--out-dir" && i + 1 < args.length) {
      outDir = args[++i];
    } else if (a === "--mode" && i + 1 < args.length) {
      mode = args[++i] as "parallel" | "sequential";
    } else if (a === "--transport" && i + 1 < args.length) {
      transport = args[++i] as BrowserAdapterId;
    } else if (a === "--arbitrate") {
      arbitrate = true;
    } else if (a === "--arbiter" && i + 1 < args.length) {
      arbitrate = true;
      arbiter = args[++i] as PlatformId;
    } else if (!a.startsWith("-")) {
      prompt = prompt ? `${prompt} ${a}` : a;
    }
  }

  return { prompt, platforms, timeoutMs, mode, outDir, transport, arbitrate, arbiter };
}

export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}

export function printHelp(): void {
  console.log(`ConvoLink CLI (convo)
Usage:
  convo doctor [--launch]        Check CDP connection, open tabs, and selector health
  convo list                     List all currently open browser tabs
  convo ask "<prompt>"           Send prompt to active browser session and stream reply
  convo compare "<prompt>"       Query multiple models in parallel and emit comparison matrix
  convo tab new <platform|url>   Spawn fresh tab for a platform (e.g. convo tab new deepseek)
  convo tab close <targetId>     Close a specific browser tab cleanly
  convo back [targetId]          Navigate active tab back in browser history
  convo undo [targetId]          Revert mistake by restoring previous conversation URL
  convo history [targetId]       Show recent session checkpoints and thread URLs
  convo resume <threadId>        Rehydrate and re-open saved thread from persistent SQLite ledger
  convo export <threadId>        Export structured conversation ledger (Markdown or JSON)
  convo mcp                      Launch Model Context Protocol (MCP) JSON-RPC server on stdio

Options for ask:
  --new, -n                      Reset active tab to fresh chat before submitting prompt
  --open-tab                     Spawn brand new tab in background before submitting
  --platform <id>                Target specific platform (deepseek | chatgpt | gemini)
  --target <targetId>            Target specific browser tab targetId
  --transport <name>             Transport engine: raw-cdp (default) | agent-browser | firefox-bidi
  --think / --no-think           Enable or disable deep thinking mode
  --search / --no-search         Enable or disable web search mode
  --timeout <ms>                 Response wait timeout in milliseconds (default: 120000)
  --write-files, -w              Extract and save code blocks to local workspace
  --out-dir <path>               Output directory for saved artifacts (default: ./artifacts)
  --no-continue                  Disable automated stream continuation

Options for compare:
  --platforms <p1,p2>            Comma-separated platforms (default: chatgpt,deepseek,gemini)
  --mode <parallel|sequential>   Execution schedule (default: parallel)
  --arbitrate                    Trigger Stage 2 Technical Arbiter consensus synthesis
  --arbiter <platform>           Designate specific arbiter platform (e.g. deepseek)
  --out-dir <path>               Directory to save REPORT.md and namespaced artifacts
  --timeout <ms>                 Timeout per model execution (default: 120000)
`);
}
