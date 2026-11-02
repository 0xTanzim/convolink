import type { createContainer } from "../container.js";
import { parseAskArgs, parseCompareArgs, readStdin } from "./cli.args.js";
import { ensureProjectProfile, resolveLaunchProfile } from "./cli.prompt.js";
import { BrowserLauncherService } from "../adapters/browsers/browser-launcher.js";
import { DaemonClient } from "../adapters/daemon/daemon-client.js";
import type { BrowserAdapterId } from "../core/ports/browser.port.js";
import type { AskResult } from "../core/services/orchestrator.types.js";
import type { ComparisonReport } from "../core/services/comparison.types.js";

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
  const effectiveBrowser = parsed.browser ?? config?.browser;
  const launchProfile = await resolveLaunchProfile(config, effectiveBrowser);
  if (parsed.launch) {
    const launcher = new BrowserLauncherService();
    await launcher.ensureBrowserRunning({
      profilePath: launchProfile.profilePath,
      profileDirectory: launchProfile.profileDirectory,
      browser: effectiveBrowser,
    });
  } else {
    const daemonClient = new DaemonClient();
    if (await daemonClient.isAlive()) {
      try {
        const res = await daemonClient.sendRequest<AskResult>("ask", {
          prompt, platform: parsed.platform, targetId: parsed.targetId,
          timeoutMs: parsed.timeoutMs, toggles: parsed.toggles,
          writeFiles: parsed.writeFiles, outDir: parsed.outDir,
          autoContinue: parsed.autoContinue, newChat: parsed.newChat, openTab: parsed.openTab,
        }, Math.max((parsed.timeoutMs ?? 180_000) + 60_000, 300_000));
        if (!res.ok) throw new Error(res.error || "Daemon request failed");
        const r = res.result!;
        console.log(r.turn.markdownContent);
        if (r.canvasDocument) console.log(`\n🎨 [Canvas Document] ${r.canvasDocument.title}`);
        if (r.writtenFiles && r.writtenFiles.length > 0) {
          console.log(`\n📁 Saved ${r.writtenFiles.length} artifact file(s):`);
          for (const f of r.writtenFiles) console.log(`  • ${f}`);
        }
        return 0;
      } catch (err: unknown) {
        console.error(`❌ Ask failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
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
  const effectiveBrowser = parsed.browser ?? config?.browser;
  const launchProfile = await resolveLaunchProfile(config, effectiveBrowser);
  if (parsed.launch) {
    const launcher = new BrowserLauncherService();
    await launcher.ensureBrowserRunning({
      profilePath: launchProfile.profilePath,
      profileDirectory: launchProfile.profileDirectory,
      browser: effectiveBrowser,
    });
  } else {
    const daemonClient = new DaemonClient();
    if (await daemonClient.isAlive()) {
      try {
        const res = await daemonClient.sendRequest<ComparisonReport>("compare", {
          prompt, platforms: parsed.platforms, mode: parsed.mode,
          timeoutMs: parsed.timeoutMs, outDir: parsed.outDir,
          arbitrate: parsed.arbitrate, arbiter: parsed.arbiter,
        }, Math.max((parsed.timeoutMs ?? 180_000) * 3, 600_000));
        if (!res.ok) throw new Error(res.error || "Daemon comparison failed");
        console.log(res.result!.markdownReport);
        return 0;
      } catch (err: unknown) {
        console.error(`❌ Comparison failed: ${err instanceof Error ? err.message : String(err)}`);
        return 1;
      }
    }
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
