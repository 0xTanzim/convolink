import type { createContainer } from "../container.js";
import { parseAskArgs, parseCompareArgs, readStdin } from "./cli.args.js";
import { BrowserLauncherService } from "../adapters/browsers/browser-launcher.js";
import { DaemonClient } from "../adapters/daemon/daemon-client.js";
import type { AskResult } from "../core/services/orchestrator.types.js";
import type { ComparisonReport } from "../core/services/comparison.types.js";
import { printJson, printError, successEnvelope, failureEnvelope } from "./cli.output.js";
import { ConvoError, fromIpcFailure } from "../core/errors/convo-error.js";
import { parseThreadList, parseThreadUrl, type ThreadTarget } from "../core/services/setup/thread-target.js";
import type { PlatformId } from "../core/ports/platform.port.js";

type Orchestrator = ReturnType<typeof createContainer>["orchestrator"];
export interface OutputFlags {
  readonly json: boolean;
}

export async function handleAsk(
  orchestrator: Orchestrator,
  args: string[],
  flags: OutputFlags = { json: false },
): Promise<number> {
  const parsed = parseAskArgs(args);
  const prompt = parsed.prompt || (await readStdin());

  if (!prompt.trim()) return fail(flags, "ask", new ConvoError("internal", "Prompt is required.", "Pass the prompt as an argument or pipe it via stdin."));

  if (parsed.launch) {
    await new BrowserLauncherService().ensureBrowserRunning({
      profilePath: parsed.profile,
      browser: parsed.browser,
    });
  }

  const thread = parsed.threadRaw ? requireThread(parsed.threadRaw) : undefined;

  if (await shouldUseDaemon(parsed.launch)) {
    const daemonClient = new DaemonClient();
    try {
      const res = await daemonClient.sendRequest<AskResult>("ask", {
        prompt, platform: parsed.platform, targetId: parsed.targetId,
        timeoutMs: parsed.timeoutMs, toggles: parsed.toggles,
        writeFiles: parsed.writeFiles, outDir: parsed.outDir,
        autoContinue: parsed.autoContinue, newChat: parsed.newChat, openTab: parsed.openTab,
        threadUrl: parsed.threadRaw,
      }, Math.max((parsed.timeoutMs ?? 180_000) + 60_000, 300_000));
      if (!res.ok) throw fromIpcFailure(res.code, res.error);
      return emitAsk(res.result!, flags);
    } catch (error) {
      return fail(flags, "ask", error);
    }
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
      ...(thread ? { thread } : {}),
      progress: { report: (event) => process.stderr.write(`${JSON.stringify({ type: "progress", ...event })}\n`) },
    });
    return emitAsk(result, flags);
  } catch (error) {
    return fail(flags, "ask", error);
  }
}

function emitAsk(result: AskResult, flags: OutputFlags): number {
  if (flags.json) {
    printJson(successEnvelope("ask", {
      platform: result.tab.platformId,
      tabId: result.tab.targetId,
      text: result.turn.markdownContent,
      elapsedMs: result.elapsedMs,
      writtenFiles: result.writtenFiles ?? [],
      riskLabels: result.riskLabels,
      redactedSecretsCount: result.redactedSecretsCount,
    }));
    return 0;
  }

  if (result.redactedSecretsCount > 0) {
    console.error(`🛡️ [PolicyGate] Redacted ${result.redactedSecretsCount} secret(s) from outbound prompt.`);
  }
  if (result.riskLabels.includes("contains_destructive_command")) {
    console.error("⚠️ [PolicyGate Warning] Inbound response contains potentially destructive shell command(s).");
  }
  console.log(result.turn.markdownContent);
  if (result.canvasDocument) console.log(`\n🎨 [Canvas Document] ${result.canvasDocument.title}`);
  if (result.writtenFiles?.length) {
    console.log(`\n📁 Saved ${result.writtenFiles.length} artifact file(s):`);
    for (const file of result.writtenFiles) console.log(`  • ${file}`);
  }
  return 0;
}

export async function handleCompare(
  orchestrator: Orchestrator,
  args: string[],
  flags: OutputFlags = { json: false },
): Promise<number> {
  const parsed = parseCompareArgs(args);
  const prompt = parsed.prompt || (await readStdin());
  if (!prompt.trim()) return fail(flags, "compare", new ConvoError("internal", "Prompt is required for comparison.", "Pass the prompt as an argument."));

  if (parsed.launch) {
    await new BrowserLauncherService().ensureBrowserRunning({ profilePath: parsed.profile, browser: parsed.browser });
  }

  try {
    let report: ComparisonReport;
    const threads = parsed.threadsRaw ? requireThreadMap(parsed.threadsRaw) : undefined;

    if (await shouldUseDaemon(parsed.launch)) {
      const res = await new DaemonClient().sendRequest<ComparisonReport>("compare", {
        prompt, platforms: parsed.platforms, mode: parsed.mode,
        timeoutMs: parsed.timeoutMs, outDir: parsed.outDir,
        arbitrate: parsed.arbitrate, arbiter: parsed.arbiter,
        threadsRaw: parsed.threadsRaw,
        continueThreads: parsed.continueThreads,
      }, Math.max((parsed.timeoutMs ?? 180_000) * 3, 600_000));
      if (!res.ok) throw fromIpcFailure(res.code, res.error);
      report = res.result!;
    } else {
      report = await orchestrator.compare({
        prompt, platforms: parsed.platforms, mode: parsed.mode, timeoutMs: parsed.timeoutMs,
        outDir: parsed.outDir, arbitrate: parsed.arbitrate, arbiter: parsed.arbiter,
        ...(threads ? { threads } : {}),
        continueThreads: parsed.continueThreads,
      });
    }
    return emitCompare(report, flags);
  } catch (error) {
    return fail(flags, "compare", error);
  }
}

function emitCompare(report: ComparisonReport, flags: OutputFlags): number {
  if (flags.json) {
    printJson(successEnvelope("compare", {
      comparisonId: report.comparisonId,
      scheduleMode: report.scheduleMode,
      totalDurationMs: report.totalDurationMs,
      fastestPlatform: report.fastestPlatform ?? null,
      results: report.results.map((result) => ({
        platform: result.platform,
        status: result.status,
        elapsedMs: result.elapsedMs,
        text: result.turn?.markdownContent ?? null,
        error: result.error ?? null,
      })),
    }));
  } else {
    console.log(report.markdownReport);
  }
  return report.results.some((result) => result.status === "success") ? 0 : 5;
}

async function shouldUseDaemon(launch: boolean): Promise<boolean> {
  if (launch) return false;
  if (await new DaemonClient().isAlive()) return true;
  try {
    const { loadResolution } = await import("./config-context.js");
    const res = await loadResolution();
    if (res.ok && (res.value.transport === "firefox-bidi" || res.value.transport === "extension-bridge")) {
      const { ensureDaemonRunning } = await import("./cli.daemon.js");
      return await ensureDaemonRunning();
    }
  } catch {}
  return false;
}

function fail(flags: OutputFlags, command: string, error: unknown): number {
  if (flags.json) {
    printJson(failureEnvelope(command, error));
    return error instanceof ConvoError ? error.exitCode : 6;
  }
  return printError(error);
}

function requireThread(raw: string): ThreadTarget {
  const parsed = parseThreadUrl(raw);
  if (!parsed.ok) throw new ConvoError(parsed.error.code, parsed.error.message, parsed.error.remediation);
  return parsed.target;
}

function requireThreadMap(raw: string): Partial<Record<PlatformId, ThreadTarget>> {
  const parsed = parseThreadList(raw);
  if (!parsed.ok) throw new ConvoError(parsed.error.code, parsed.error.message, parsed.error.remediation);
  const map: Partial<Record<PlatformId, ThreadTarget>> = {};
  for (const target of parsed.targets) map[target.platform] = target;
  return map;
}
