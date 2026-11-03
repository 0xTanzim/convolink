import type { BrowserPort } from "../ports/browser.port.js";
import type { PlatformId, PlatformPort } from "../ports/platform.port.js";
import type { PolicyGatePort } from "../ports/policy.port.js";
import type { ThreadStore, SearchResult, WorkspaceSinkPort } from "../ports/storage.port.js";
import type { LockService } from "./lock.service.js";
import type { ArtifactService } from "./artifact.service.js";
import type { SessionCheckpoint, StateJournalService } from "./journal.service.js";
import type { CompareOptions, ComparisonReport } from "./comparison.types.js";
import { TabManagerService } from "./tab-manager.service.js";
import { TabResolver } from "./tab-resolver.js";
import { ThreadExportService } from "./thread-export.service.js";
import { runDoctorAudit } from "./doctor.service.js";
import { ComparisonCoordinator } from "./comparison-coordinator.service.js";
import { AskPipelineService } from "./ask-pipeline.service.js";
import { PlatformDriverNotFoundError, TabNotFoundError } from "../errors/bridge-errors.js";
import type { AskOptions, AskResult, DiscoveredTab, DoctorReport, OrchestratorDependencies } from "./orchestrator.types.js";

export * from "./orchestrator.types.js";

export class SessionOrchestrator {
  private browser: BrowserPort;
  private readonly drivers: readonly PlatformPort[];
  private readonly lockService: LockService;
  private readonly policyGate: PolicyGatePort;
  private readonly artifactService?: ArtifactService;
  private readonly fileSink?: WorkspaceSinkPort;
  private readonly journalService?: StateJournalService;
  private readonly threadStore?: ThreadStore;
  private tabManager: TabManagerService;
  private readonly comparisonCoordinator: ComparisonCoordinator;
  private askPipeline: AskPipelineService;

  public constructor(deps: OrchestratorDependencies) {
    this.browser = deps.browser;
    this.drivers = deps.drivers;
    this.lockService = deps.lockService;
    this.policyGate = deps.policyGate;
    this.artifactService = deps.artifactService;
    this.fileSink = deps.fileSink;
    this.journalService = deps.journalService;
    this.threadStore = deps.threadStore;
    this.tabManager = deps.tabManager ?? new TabManagerService(this.browser, this.drivers, this.lockService, deps.journalService);
    this.comparisonCoordinator = deps.comparisonCoordinator ?? new ComparisonCoordinator(this, this.tabManager, this.fileSink);
    deps.comparisonCoordinator?.bindOrchestrator(this);
    this.askPipeline = this.buildAskPipeline();
  }

  private buildAskPipeline(): AskPipelineService {
    return new AskPipelineService({
      browser: this.browser,
      drivers: this.drivers,
      lockService: this.lockService,
      policyGate: this.policyGate,
      tabManager: this.tabManager,
      artifactService: this.artifactService,
      fileSink: this.fileSink,
      journalService: this.journalService,
      threadStore: this.threadStore,
      listTabs: () => this.listTabs(),
    });
  }

  public async listTabs(): Promise<DiscoveredTab[]> {
    const rawTabs = await this.browser.listTabs();
    return rawTabs.map((t) => TabResolver.toDiscoveredTab(t, this.drivers));
  }

  public async doctor(): Promise<DoctorReport> {
    let tabs: DiscoveredTab[] = [];
    try { tabs = await this.listTabs(); } catch {}
    return runDoctorAudit(this.browser, tabs, (url) => TabResolver.findDriver(url, this.drivers), this.lockService);
  }

  public createTab(platformOrUrl: PlatformId | string): Promise<DiscoveredTab> { return this.tabManager.createTab(platformOrUrl); }
  public closeTab(targetId: string): Promise<void> { return this.tabManager.closeTab(targetId); }
  public getBrowser(): BrowserPort { return this.browser; }
  public setBrowser(browser: BrowserPort): void {
    this.browser = browser;
    this.tabManager = new TabManagerService(browser, this.drivers, this.lockService, this.journalService);
    this.askPipeline = this.buildAskPipeline();
  }
  public getDrivers(): readonly PlatformPort[] { return this.drivers; }
  public getHistory(targetId?: string): readonly SessionCheckpoint[] { return this.journalService?.list(targetId) ?? []; }

  public async startNewChat(targetId?: string, platform?: PlatformId): Promise<DiscoveredTab> {
    const tabs = await this.listTabs();
    const tab = TabResolver.resolveTargetTab({ targetId, platform, prompt: "" }, tabs);
    const driver = TabResolver.findDriver(tab.url, this.drivers);
    if (!driver) throw new PlatformDriverNotFoundError(tab.url);
    await this.tabManager.startNewChat(tab, driver);
    return tab;
  }

  public async undo(targetId?: string): Promise<{ restoredUrl: string } | null> {
    return this.tabManager.undo(TabResolver.resolveTargetTab({ targetId, prompt: "" }, await this.listTabs()));
  }

  public async goBack(targetId?: string): Promise<void> {
    return this.tabManager.goBack(TabResolver.resolveTargetTab({ targetId, prompt: "" }, await this.listTabs()).targetId);
  }

  public async shutdown(): Promise<void> {
    await this.browser.disconnect?.().catch(() => {});
  }

  public async compare(options: CompareOptions): Promise<ComparisonReport> { return this.comparisonCoordinator.run(options); }
  public async searchLedger(query: string, limit?: number): Promise<SearchResult[]> {
    return this.threadStore?.searchTurns ? this.threadStore.searchTurns(query, limit) : [];
  }

  public async resumeThread(threadId: string): Promise<DiscoveredTab> {
    if (!this.threadStore) throw new Error("No ThreadStore configured");
    const thread = (await this.threadStore.listThreads()).find((t) => t.threadId === threadId);
    if (!thread) throw new TabNotFoundError(`thread:${threadId}`);
    return this.createTab(thread.url);
  }

  public async exportThread(threadId: string, format: "json" | "markdown" = "markdown"): Promise<string> {
    if (!this.threadStore) throw new Error("No ThreadStore configured");
    const thread = (await this.threadStore.listThreads()).find((t) => t.threadId === threadId);
    if (!thread) throw new TabNotFoundError(`thread:${threadId}`);
    const turns = await this.threadStore.getTurns(threadId);
    return format === "json" ? ThreadExportService.formatJson(thread, turns) : ThreadExportService.formatMarkdown(thread, turns);
  }

  public ask(options: AskOptions): Promise<AskResult> {
    return this.askPipeline.execute(options);
  }
}
