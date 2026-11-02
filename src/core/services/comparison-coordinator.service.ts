import type { PlatformId } from "../ports/platform.port.js";
import type { SessionOrchestrator } from "./orchestrator.js";
import type { TabManagerService } from "./tab-manager.service.js";
import type { WorkspaceSinkPort } from "../ports/storage.port.js";
import type { CompareOptions, ComparisonReport } from "./comparison.types.js";
import type { DiscoveredTab } from "./orchestrator.types.js";
import { SubmitSequencer } from "./submit-sequencer.js";
import { ComparisonEngineService } from "./comparison-engine.service.js";
import { ComparisonReportService } from "./comparison-report.service.js";
import { TabNotFoundError } from "../errors/bridge-errors.js";

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
        orchestrator.ask({ prompt, targetId: tab.targetId, timeoutMs, onSubmitted }),
      ),
    );
  }

  public async run(options: CompareOptions): Promise<ComparisonReport> {
    if (!this.orchestrator || !this.engine) {
      throw new Error("ComparisonCoordinator has not been bound to an orchestrator instance");
    }

    const platforms: PlatformId[] = options.platforms && options.platforms.length > 0
      ? options.platforms
      : ["chatgpt", "deepseek", "gemini"];

    const allTabs = await this.orchestrator.listTabs();
    const targetTabs: DiscoveredTab[] = [];

    for (const p of platforms) {
      let tab = allTabs.find((t) => t.platformId === p && !targetTabs.some((used) => used.targetId === t.targetId));
      if (!tab && options.autoSpawn !== false) {
        tab = await this.tabManager.createTab(p);
      }
      if (!tab) throw new TabNotFoundError(`platform:${p}`);
      targetTabs.push(tab);
    }

    const comparisonId = `cmp-${Date.now()}`;
    const start = Date.now();
    const mode = options.mode ?? "parallel";

    const execution = await this.engine.executeComparisonWithArbitration({
      prompt: options.prompt,
      tabs: targetTabs,
      mode,
      timeoutMs: options.timeoutMs,
      staggerMs: mode === "parallel" ? 250 : 0,
      arbitrate: options.arbitrate,
      arbiter: options.arbiter,
    });

    const results = execution.results;
    const arbitration = execution.arbitration;
    const totalDurationMs = Date.now() - start;
    const metrics = this.reporter.computeMetrics(results);
    const fastestPlatform = this.reporter.determineFastestPlatform(metrics);
    const markdownReport = this.reporter.buildMarkdownReport(comparisonId, options.prompt, results, metrics, mode, arbitration);

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
      totalDurationMs,
      results,
      metrics,
      fastestPlatform,
      arbitration,
      markdownReport,
    };
  }
}
