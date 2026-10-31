import type { PlatformId, ToggleOptions } from "../core/ports/platform.port.js";

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
  transport?: "raw-cdp" | "agent-browser";
}

export function parseAskArgs(args: string[]): ParsedAskArgs {
  let prompt = "", platform: PlatformId | undefined, targetId: string | undefined, timeoutMs: number | undefined;
  let think: boolean | undefined, search: boolean | undefined, writeFiles: boolean | undefined;
  let outDir: string | undefined, autoContinue: boolean | undefined;
  let newChat = false, openTab = false;
  let transport: "raw-cdp" | "agent-browser" | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--platform" && i + 1 < args.length) platform = args[++i] as PlatformId;
    else if (a === "--target" && i + 1 < args.length) targetId = args[++i];
    else if (a === "--timeout" && i + 1 < args.length) timeoutMs = Number(args[++i]);
    else if (a === "--out-dir" && i + 1 < args.length) outDir = args[++i];
    else if (a === "--transport" && i + 1 < args.length) transport = args[++i] as "raw-cdp" | "agent-browser";
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

export function printHelp(): void {
  console.log(`ConvoLink CLI (convo)
Usage:
  convo doctor [--launch]        Check CDP connection, open tabs, and selector health
  convo list                     List all currently open browser tabs
  convo ask "<prompt>"           Send prompt to active browser session and stream reply
  convo tab new <platform|url>   Spawn fresh tab for a platform (e.g. convo tab new deepseek)
  convo tab close <targetId>     Close a specific browser tab cleanly
  convo back [targetId]          Navigate active tab back in browser history
  convo undo [targetId]          Revert mistake by restoring previous conversation URL
  convo history [targetId]       Show recent session checkpoints and thread URLs

Options for ask:
  --new, -n                      Reset active tab to fresh chat before submitting prompt
  --open-tab                     Spawn brand new tab in background before submitting
  --platform <id>                Target specific platform (deepseek | chatgpt | gemini)
  --target <targetId>            Target specific browser tab targetId
  --transport <name>             Transport engine: raw-cdp (default) | agent-browser
  --think / --no-think           Enable or disable deep thinking mode
  --search / --no-search         Enable or disable web search mode
  --timeout <ms>                 Response wait timeout in milliseconds (default: 120000)
  --write-files, -w              Extract and save code blocks to local workspace
  --out-dir <path>               Output directory for saved artifacts (default: ./artifacts)
  --no-continue                  Disable automated stream continuation
`);
}
