import type { SessionHandle, TabDescriptor } from "../ports/browser.port.js";
import type { PlatformId, PlatformPort } from "../ports/platform.port.js";
import type { BrowserPort } from "../ports/browser.port.js";
import type { PolicyGatePort } from "../ports/policy.port.js";
import type { LockService } from "./lock.service.js";
import type { ArtifactService } from "./artifact.service.js";
import type { WorkspaceFileSink } from "./workspace-sink.service.js";
import type { StateJournalService } from "./journal.service.js";
import { TabManagerService } from "./tab-manager.service.js";
import { runDoctorAudit } from "./doctor.service.js";
import { PlatformDriverNotFoundError, TabNotFoundError } from "../errors/bridge-errors.js";
import type {
  AskOptions,
  AskResult,
  DiscoveredTab,
  DoctorReport,
  OrchestratorDependencies,
} from "./orchestrator.types.js";

export * from "./orchestrator.types.js";

export class SessionOrchestrator {
  private readonly browser: BrowserPort;
  private readonly drivers: readonly PlatformPort[];
  private readonly lockService: LockService;
  private readonly policyGate: PolicyGatePort;
  private readonly artifactService?: ArtifactService;
  private readonly fileSink?: WorkspaceFileSink;
  private readonly journalService?: StateJournalService;
  private readonly tabManager: TabManagerService;

  public constructor(deps: OrchestratorDependencies) {
    this.browser = deps.browser;
    this.drivers = deps.drivers;
    this.lockService = deps.lockService;
    this.policyGate = deps.policyGate;
    this.artifactService = deps.artifactService;
    this.fileSink = deps.fileSink;
    this.journalService = deps.journalService;
    this.tabManager = new TabManagerService(this.browser, this.drivers, this.lockService, deps.journalService);
  }

  public async listTabs(): Promise<DiscoveredTab[]> {
    const rawTabs = await this.browser.listTabs();
    return rawTabs.map((t) => this.toDiscoveredTab(t));
  }

  public async doctor(): Promise<DoctorReport> {
    const tabs = await this.listTabs();
    return runDoctorAudit(this.browser, tabs, (url) => this.findDriver(url), this.lockService);
  }

  public async createTab(platformOrUrl: PlatformId | string): Promise<DiscoveredTab> {
    return this.tabManager.createTab(platformOrUrl);
  }

  public async closeTab(targetId: string): Promise<void> {
    return this.tabManager.closeTab(targetId);
  }

  public async startNewChat(targetId?: string, platform?: PlatformId): Promise<DiscoveredTab> {
    const tabs = await this.listTabs();
    const tab = this.resolveTargetTab({ targetId, platform, prompt: "" }, tabs);
    const driver = this.findDriver(tab.url);
    if (!driver) throw new PlatformDriverNotFoundError(tab.url);
    await this.tabManager.startNewChat(tab, driver);
    return tab;
  }

  public async undo(targetId?: string): Promise<{ restoredUrl: string } | null> {
    const tabs = await this.listTabs();
    const tab = this.resolveTargetTab({ targetId, prompt: "" }, tabs);
    return this.tabManager.undo(tab);
  }

  public async goBack(targetId?: string): Promise<void> {
    const tabs = await this.listTabs();
    const tab = this.resolveTargetTab({ targetId, prompt: "" }, tabs);
    return this.tabManager.goBack(tab.targetId);
  }

  public async ask(options: AskOptions): Promise<AskResult> {
    const tabs = await this.listTabs();
    const targetTab = options.openTab
      ? await this.createTab(options.platform ?? "chatgpt")
      : this.resolveTargetTab(options, tabs);

    const driver = this.findDriver(targetTab.url);
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

      let currentTurn = completion.turn;
      let contCount = 0;
      while (options.autoContinue !== false && contCount < 5 && driver.findContinuationTrigger) {
        const trigger = await driver.findContinuationTrigger(sessionHandle, this.browser);
        if (!trigger.hasContinuation || !driver.triggerContinuation) break;
        contCount++;
        await driver.triggerContinuation(sessionHandle, this.browser);
        const nextComp = await driver.awaitCompletion(
          sessionHandle,
          this.browser,
          { turnCount: currentTurn.turnIndex + 1, lastTurnHash: String(currentTurn.turnIndex) },
          timeoutMs,
        );
        currentTurn = {
          ...currentTurn,
          markdownContent: `${currentTurn.markdownContent}\n${nextComp.turn.markdownContent}`,
          codeBlocks: [...currentTurn.codeBlocks, ...nextComp.turn.codeBlocks],
        };
      }

      const canvasDocument = driver.inspectCanvas ? await driver.inspectCanvas(sessionHandle, this.browser) : null;
      const artifacts = this.artifactService ? this.artifactService.extractArtifacts(currentTurn.markdownContent, currentTurn.codeBlocks) : [];
      let writtenFiles: string[] = [];

      if (options.writeFiles && this.fileSink && artifacts.length > 0) {
        const res = await this.fileSink.persist(artifacts, { outDir: options.outDir ?? "./artifacts", overwrite: true });
        writtenFiles = res.writtenFiles.map((f) => f.path);
      }

      this.journalService?.record({
        targetId: targetTab.targetId,
        platformId: targetTab.platformId,
        url: targetTab.url,
        threadId: targetTab.threadId,
        action: "ask",
      });

      return {
        tab: targetTab,
        turn: currentTurn,
        elapsedMs: completion.elapsedMs,
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

  private toDiscoveredTab(raw: TabDescriptor): DiscoveredTab {
    const driver = this.findDriver(raw.url);
    return {
      targetId: raw.targetId,
      title: raw.title,
      url: raw.url,
      platformId: driver?.id ?? null,
      threadId: driver ? driver.extractThreadId(raw.url) : null,
    };
  }

  private findDriver(url: string): PlatformPort | undefined {
    return this.drivers.find((d) => d.matchesUrl(url));
  }

  private resolveTargetTab(options: { targetId?: string; platform?: PlatformId; prompt?: string }, tabs: DiscoveredTab[]): DiscoveredTab {
    if (options.targetId) {
      const found = tabs.find((t) => t.targetId === options.targetId);
      if (!found) throw new TabNotFoundError(`targetId:${options.targetId}`);
      return found;
    }
    if (options.platform) {
      const found = tabs.find((t) => t.platformId === options.platform);
      if (!found) throw new TabNotFoundError(`platform:${options.platform}`);
      return found;
    }
    const supported = tabs.find((t) => t.platformId !== null);
    if (!supported) throw new TabNotFoundError("No active tabs with supported AI platform found");
    return supported;
  }
}
