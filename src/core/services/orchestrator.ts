import type { BrowserPort, SessionHandle, TabDescriptor } from "../ports/browser.port.js";
import type { PlatformId, PlatformPort, ConversationTurn } from "../ports/platform.port.js";
import type { PolicyGatePort } from "../ports/policy.port.js";
import type { ThreadStore, SearchResult } from "../ports/storage.port.js";
import type { LockService } from "./lock.service.js";
import type { ArtifactService } from "./artifact.service.js";
import type { WorkspaceFileSink } from "./workspace-sink.service.js";
import type { StateJournalService } from "./journal.service.js";
import type { CompareOptions, ComparisonReport } from "./comparison.types.js";
import { TabManagerService } from "./tab-manager.service.js";
import { TabResolver } from "./tab-resolver.js";
import { ThreadExportService } from "./thread-export.service.js";
import { runDoctorAudit } from "./doctor.service.js";
import { ComparisonCoordinator } from "./comparison-coordinator.service.js";
import { PlatformDriverNotFoundError, TabNotFoundError } from "../errors/bridge-errors.js";
import type { AskOptions, AskResult, DiscoveredTab, DoctorReport, OrchestratorDependencies } from "./orchestrator.types.js";

export * from "./orchestrator.types.js";

export class SessionOrchestrator {
  private readonly browser: BrowserPort;
  private readonly drivers: readonly PlatformPort[];
  private readonly lockService: LockService;
  private readonly policyGate: PolicyGatePort;
  private readonly artifactService?: ArtifactService;
  private readonly fileSink?: WorkspaceFileSink;
  private readonly journalService?: StateJournalService;
  private readonly threadStore?: ThreadStore;
  private readonly tabManager: TabManagerService;

  public constructor(deps: OrchestratorDependencies) {
    this.browser = deps.browser;
    this.drivers = deps.drivers;
    this.lockService = deps.lockService;
    this.policyGate = deps.policyGate;
    this.artifactService = deps.artifactService;
    this.fileSink = deps.fileSink;
    this.journalService = deps.journalService;
    this.threadStore = deps.threadStore;
    this.tabManager = new TabManagerService(this.browser, this.drivers, this.lockService, deps.journalService);
  }

  public async listTabs(): Promise<DiscoveredTab[]> {
    const rawTabs = await this.browser.listTabs();
    return rawTabs.map((t) => TabResolver.toDiscoveredTab(t, this.drivers));
  }

  public async doctor(): Promise<DoctorReport> {
    const tabs = await this.listTabs();
    return runDoctorAudit(this.browser, tabs, (url) => TabResolver.findDriver(url, this.drivers), this.lockService);
  }

  public createTab(platformOrUrl: PlatformId | string): Promise<DiscoveredTab> {
    return this.tabManager.createTab(platformOrUrl);
  }

  public closeTab(targetId: string): Promise<void> {
    return this.tabManager.closeTab(targetId);
  }

  public async startNewChat(targetId?: string, platform?: PlatformId): Promise<DiscoveredTab> {
    const tabs = await this.listTabs();
    const tab = TabResolver.resolveTargetTab({ targetId, platform, prompt: "" }, tabs);
    const driver = TabResolver.findDriver(tab.url, this.drivers);
    if (!driver) throw new PlatformDriverNotFoundError(tab.url);
    await this.tabManager.startNewChat(tab, driver);
    return tab;
  }

  public async undo(targetId?: string): Promise<{ restoredUrl: string } | null> {
    const tabs = await this.listTabs();
    return this.tabManager.undo(TabResolver.resolveTargetTab({ targetId, prompt: "" }, tabs));
  }

  public async goBack(targetId?: string): Promise<void> {
    const tabs = await this.listTabs();
    return this.tabManager.goBack(TabResolver.resolveTargetTab({ targetId, prompt: "" }, tabs).targetId);
  }

  public async compare(options: CompareOptions): Promise<ComparisonReport> {
    return new ComparisonCoordinator(this, this.tabManager, this.fileSink).run(options);
  }

  public async searchLedger(query: string, limit?: number): Promise<SearchResult[]> {
    if (!this.threadStore?.searchTurns) return [];
    return this.threadStore.searchTurns(query, limit);
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

  public async ask(options: AskOptions): Promise<AskResult> {
    const tabs = await this.listTabs();
    const targetTab = options.openTab
      ? await this.createTab(options.platform ?? "chatgpt")
      : TabResolver.resolveTargetTab(options, tabs);

    const driver = TabResolver.findDriver(targetTab.url, this.drivers);
    if (!driver) throw new PlatformDriverNotFoundError(targetTab.url);

    if (options.newChat) {
      await this.tabManager.startNewChat(targetTab, driver);
    }

    const sanitized = this.policyGate.sanitizeOutboundPrompt(options.prompt);
    const lockHandle = await this.lockService.acquireLock(targetTab.targetId);
    let sessionHandle: SessionHandle | null = null;

    try {
      sessionHandle = await this.browser.attach(targetTab.targetId);
      await this.browser.keepAliveInBackground(sessionHandle);

      if (options.toggles) {
        await driver.applyToggles(sessionHandle, this.browser, options.toggles);
      }

      const timeoutMs = options.timeoutMs ?? 120_000;
      const fingerprint = await driver.submitPrompt(sessionHandle, this.browser, sanitized.cleanText, options.files);
      const completion = await driver.awaitCompletion(sessionHandle, this.browser, fingerprint, timeoutMs);
      const currentTurn = options.autoContinue !== false
        ? await this.autoContinueTurn(sessionHandle, driver, completion.turn, timeoutMs)
        : completion.turn;

      const canvasDocument = driver.inspectCanvas ? await driver.inspectCanvas(sessionHandle, this.browser) : null;
      const artifacts = this.artifactService ? this.artifactService.extractArtifacts(currentTurn.markdownContent, currentTurn.codeBlocks) : [];
      let writtenFiles: string[] = [];

      if (options.writeFiles && this.fileSink && artifacts.length > 0) {
        const res = await this.fileSink.persist(artifacts, { outDir: options.outDir ?? "./artifacts", overwrite: true });
        writtenFiles = res.writtenFiles.map((f) => f.path);
      }

      this.journalService?.record({
        targetId: targetTab.targetId, platformId: targetTab.platformId,
        url: targetTab.url, threadId: targetTab.threadId, action: "ask",
      });

      if (this.threadStore && targetTab.platformId) {
        const key = targetTab.threadId ?? targetTab.targetId;
        await this.threadStore.upsertThread({
          threadId: key, platform: targetTab.platformId, title: targetTab.title,
          url: targetTab.url, lastSyncedTurnCount: currentTurn.turnIndex + 1, updatedAt: new Date().toISOString(),
        });
        await this.threadStore.appendTurns(key, [currentTurn]);
      }

      return {
        tab: targetTab, turn: currentTurn, elapsedMs: completion.elapsedMs,
        riskLabels: this.policyGate.classifyInboundResponse(currentTurn.markdownContent),
        redactedSecretsCount: sanitized.redactedCount,
        artifacts: artifacts.length > 0 ? artifacts : undefined,
        writtenFiles: writtenFiles.length > 0 ? writtenFiles : undefined,
        canvasDocument,
      };
    } finally {
      if (sessionHandle) await this.browser.detach(sessionHandle);
      this.lockService.releaseLock(lockHandle);
    }
  }

  private async autoContinueTurn(
    handle: SessionHandle, driver: PlatformPort, initial: ConversationTurn, timeoutMs: number,
  ): Promise<ConversationTurn> {
    let current = initial;
    let count = 0;
    while (count < 5 && driver.findContinuationTrigger && driver.triggerContinuation) {
      const trigger = await driver.findContinuationTrigger(handle, this.browser);
      if (!trigger.hasContinuation) break;
      count++;
      await driver.triggerContinuation(handle, this.browser);
      const next = await driver.awaitCompletion(
        handle, this.browser,
        { turnCount: current.turnIndex + 1, lastTurnHash: String(current.turnIndex) },
        timeoutMs,
      );
      current = {
        ...current,
        markdownContent: `${current.markdownContent}\n${next.turn.markdownContent}`,
        codeBlocks: [...current.codeBlocks, ...next.turn.codeBlocks],
      };
    }
    return current;
  }
}
