import type { PlatformId, ToggleOptions } from "../core/ports/platform.port.js";
import type { BrowserAdapterId } from "../core/ports/browser.port.js";
export { printHelp } from "./cli.help.js";

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
  browser?: string;
  profile?: string;
  threadRaw?: string;
  launch: boolean;
}

export function parseAskArgs(args: string[]): ParsedAskArgs {
  let prompt = "", platform: PlatformId | undefined, targetId: string | undefined, timeoutMs: number | undefined;
  let think: boolean | undefined, search: boolean | undefined, writeFiles: boolean | undefined;
  let outDir: string | undefined, autoContinue: boolean | undefined;
  let newChat = false, openTab = false, launch = false;
  let transport: BrowserAdapterId | undefined, profile: string | undefined, browser: string | undefined;
  let threadRaw: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if ((a === "--platform" || a === "-p") && i + 1 < args.length) platform = args[++i] as PlatformId;
    else if ((a === "--target" || a === "-t" || a === "--targetId") && i + 1 < args.length) targetId = args[++i];
    else if (a === "--profile" && i + 1 < args.length) profile = args[++i];
    else if (a === "--thread" && i + 1 < args.length) threadRaw = args[++i];
    else if ((a === "--browser" || a === "-b") && i + 1 < args.length) browser = args[++i];
    else if (a === "--launch") launch = true;
    else if (a === "--timeout" && i + 1 < args.length) timeoutMs = Number(args[++i]);
    else if ((a === "--out-dir" || a === "--outDir" || a === "-o") && i + 1 < args.length) outDir = args[++i];
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
  return { prompt, platform, targetId, timeoutMs, toggles, writeFiles, outDir, autoContinue, newChat, openTab, transport, profile, browser, threadRaw, launch };
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
  profile?: string;
  browser?: string;
  threadsRaw?: string;
  continueThreads: boolean;
  launch: boolean;
}

export function parseCompareArgs(args: string[]): ParsedCompareArgs {
  let prompt = "", timeoutMs: number | undefined, outDir: string | undefined;
  let mode: "parallel" | "sequential" | undefined;
  let platforms: PlatformId[] | undefined;
  let transport: BrowserAdapterId | undefined;
  let arbitrate: boolean | undefined;
  let arbiter: PlatformId | undefined;
  let profile: string | undefined;
  let browser: string | undefined;
  let launch = false;
  let threadsRaw: string | undefined;
  let continueThreads = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--platforms" && i + 1 < args.length) {
      platforms = args[++i]!.split(",").map((p) => p.trim()) as PlatformId[];
    } else if (a === "--profile" && i + 1 < args.length) {
      profile = args[++i];
    } else if ((a === "--browser" || a === "-b") && i + 1 < args.length) {
      browser = args[++i];
    } else if (a === "--threads" && i + 1 < args.length) {
      threadsRaw = args[++i];
    } else if (a === "--continue") {
      continueThreads = true;
    } else if (a === "--launch") {
      launch = true;
    } else if (a === "--timeout" && i + 1 < args.length) {
      timeoutMs = Number(args[++i]);
    } else if ((a === "--out-dir" || a === "--outDir" || a === "-o") && i + 1 < args.length) {
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

  return { prompt, platforms, timeoutMs, mode, outDir, transport, arbitrate, arbiter, profile, browser, threadsRaw, continueThreads, launch };
}

export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  let data = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) data += chunk;
  return data.trim();
}
