import type { createContainer } from "../container.js";
import { parseAskArgs, parseCompareArgs, readStdin } from "./cli.args.js";
import { ensureProjectProfile } from "./cli.prompt.js";
import { BrowserLauncherService } from "../adapters/browsers/browser-launcher.js";
import type { BrowserAdapterId } from "../core/ports/browser.port.js";

type Orchestrator = ReturnType<typeof createContainer>["orchestrator"];

export async function handleAsk(
  orchestrator: Orchestrator,
  args: string[],
  _transport?: BrowserAdapterId,
): Promise<number> {
  const parsed = parseAskArgs(args);
  const prompt = parsed.prompt || (await readStdin());

  if (!prompt.trim()) {
    console.error("Error: Prompt is required. Provide as arguments or pipe via stdin.");
    return 1;
  }

  const config = await ensureProjectProfile({ profileArg: parsed.profile });
  const launcher = new BrowserLauncherService();
  await launcher.ensureBrowserRunning({
    profilePath: config?.profilePath,
    profileDirectory: config?.profileId,
    browser: config?.browser,
  });

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

export async function handleCompare(
  orchestrator: Orchestrator,
  args: string[],
): Promise<number> {
  const parsed = parseCompareArgs(args);
  const prompt = parsed.prompt || (await readStdin());
  if (!prompt.trim()) {
    console.error("Error: Prompt is required for comparison.");
    return 1;
  }

  const config = await ensureProjectProfile({ profileArg: parsed.profile });
  const launcher = new BrowserLauncherService();
  await launcher.ensureBrowserRunning({
    profilePath: config?.profilePath,
    profileDirectory: config?.profileId,
    browser: config?.browser,
  });
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
