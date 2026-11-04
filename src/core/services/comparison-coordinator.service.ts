import type { PlatformId } from "../ports/platform.port.js";
import type { SessionOrchestrator } from "./orchestrator.js";
import type { TabManagerService } from "./tab-manager.service.js";
import type { WorkspaceSinkPort } from "../ports/storage.port.js";
import type { CompareOptions, ComparisonReport, ModelExecutionResult } from "./comparison.types.js";
import type { DiscoveredTab } from "./orchestrator.types.js";
import { SubmitSequencer } from "./submit-sequencer.js";
import { shouldStartFresh } from "./tab-plan.js";
import { ComparisonEngineService } from "./comparison-engine.service.js";
import { ComparisonReportService } from "./comparison-report.service.js";
import { isContinuableThread } from "./setup/thread-target.js";

const DEFAULT_PLATFORMS: readonly PlatformId[] = ["chatgpt", "deepseek", "gemini"];

export class ComparisonCoordinator {
  private orchestrator?: SessionOrchestrator;
  private readonly tabManager: TabManagerService;
  private readonly fileSink?: WorkspaceSinkPort;
  private engine?: ComparisonEngineService;
  private readonly reporter: ComparisonReportService;

  public constructor(
    orchestrator?: SessionOrchestrator,
    tabManager?: TabManagerService,
    fileSink?: WorkspaceSinkPort,
  ) {
    this.tabManager = tabManager!;
    this.fileSink = fileSink;
    this.reporter = new ComparisonReportService();
    if (orchestrator) {
      this.bindOrchestrator(orchestrator);
    }
  }

  public bindOrchestrator(orchestrator: SessionOrchestrator): void {
    this.orchestrator = orchestrator;
    const sequencer = new SubmitSequencer();
    this.engine = new ComparisonEngineService((tab, prompt, timeoutMs) =>
      sequencer.run((onSubmitted) =>
        orchestrator.ask({
          prompt,
          targetId: tab.targetId,
          timeoutMs,
          onSubmitted,
        }),
      ),
    );
  }

  public async run(options: CompareOptions): Promise<ComparisonReport> {
    if (!this.orchestrator || !this.engine) {
      throw new Error("ComparisonCoordinator has not been bound to an orchestrator instance");
    }

    const platforms = options.platforms?.length ? options.platforms : DEFAULT_PLATFORMS;
    const allTabs = await this.orchestrator.listTabs();
    const targetTabs: DiscoveredTab[] = [];
    const createdThisRun: string[] = [];

    try {
      for (const platform of platforms) {
        const thread = options.threads?.[platform];
        const fresh = shouldStartFresh({
          hasThread: Boolean(thread),
          continueThreads: options.continueThreads === true,
          freshByDefault: true,
        });

        // Fresh comparisons get their own tab. Resetting an existing SPA by
        // navigation races hydration, so "fresh" here means "new tab", never
        // "reload this one".
        const tab = fresh
          ? await this.tabManager.createTab(platform)
          : await this.tabManager.resolveOrAutoOpenTab(
              { platform, ...(thread ? { thread } : {}) },
              allTabs,
            );

        // Every tab opened by this run is closed again, whether it was fresh
        // or opened only to reach a named thread. Otherwise each comparison
        // leaves a tab per platform behind.
        if (tab.isNewlyCreated) createdThisRun.push(tab.targetId);
        targetTabs.push(tab);
      }

      const comparisonId = `cmp-${Date.now()}`;
      const start = Date.now();
      // Gecko allows one BiDi session. Long in-page waits from several tabs
      // queue on that socket and deadlock, so one platform at a time is the
      // reliable default; parallel remains opt-in.
      const mode = options.mode ?? "sequential";
      let focusCycler: ((targetId: string) => Promise<void>) | undefined;
      const browser = this.orchestrator.getBrowser();
      if (mode === "parallel" && browser && (browser.id === "firefox-bidi" || browser.capabilities?.browserFamily === "firefox")) {
        focusCycler = async (targetId: string) => {
          await browser.bringToFront({ sessionId: `bidi-${targetId}`, targetId, adapterId: browser.id }).catch(() => {});
        };
      }

      const execution = await this.engine.executeComparisonWithArbitration({
        prompt: options.prompt,
        tabs: targetTabs,
        mode,
        timeoutMs: options.timeoutMs,
        staggerMs: mode === "parallel" ? 250 : 0,
        focusCycler,
        arbitrate: options.arbitrate,
        arbiter: options.arbiter,
      });

      const results = execution.results;
      const metrics = this.reporter.computeMetrics(results);
      const fastestPlatform = this.reporter.determineFastestPlatform(metrics);
      const markdownReport = `${this.reporter.buildMarkdownReport(
        comparisonId,
        options.prompt,
        results,
        metrics,
        mode,
        execution.arbitration,
      )}

---

## Thread URLs

Pass these back with \`--threads\` (or the MCP \`threads\` argument) to continue the same conversations on the next comparison.

${this.threadLines(results)}
`;

      if (options.outDir && this.fileSink) {
        await this.fileSink.persist(
          [{ relativePath: "REPORT.md", language: "markdown", content: markdownReport, isExplicitPath: true }],
          { outDir: options.outDir, overwrite: true },
        );
        await this.reporter.saveNamespacedArtifacts(results, `${options.outDir}/artifacts`, this.fileSink);
      }

      return {
        comparisonId,
        prompt: options.prompt,
        scheduleMode: mode,
        timestamp: new Date().toISOString(),
        totalDurationMs: Date.now() - start,
        results,
        metrics,
        fastestPlatform,
        arbitration: execution.arbitration,
        markdownReport,
      };
    } finally {
      for (const targetId of createdThisRun) {
        await this.tabManager.closeTab(targetId).catch(() => {});
      }
    }
  }

  private threadLines(results: readonly ModelExecutionResult[]): string {
    return results
      .map((result) =>
        isContinuableThread(result.platform, result.tab.threadId)
          ? `- **${result.platform}**: ${result.tab.url}`
          : `- **${result.platform}**: not continuable (${result.platform} exposes no stable conversation URL)`,
      )
      .join("\n");
  }
}
