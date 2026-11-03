import type { BrowserPort, SessionHandle } from "../ports/browser.port.js";
import type { PlatformId, PlatformPort, ConversationTurn } from "../ports/platform.port.js";
import type { PolicyGatePort } from "../ports/policy.port.js";
import type { ThreadStore, SearchResult, WorkspaceSinkPort } from "../ports/storage.port.js";
import type { LockHandle, LockService } from "./lock.service.js";
import type { ArtifactService } from "./artifact.service.js";
import type { SessionCheckpoint, StateJournalService } from "./journal.service.js";
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

  /** Releases the remote session, which Gecko allows only one of. */
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

  public async ask(options: AskOptions): Promise<AskResult> {
    const debug = (message: string) => {
      if (process.env.CONVOLINK_DEBUG === "1") process.stderr.write(`[ask] ${message}\n`);
    };
    debug("start");
    const tabs = await this.listTabs();
    const targetTab = await this.tabManager.resolveOrAutoOpenTab(options, tabs);
    debug(`tab ${targetTab.targetId}`);

    const driver = TabResolver.findDriver(targetTab.url, this.drivers);
    if (!driver) throw new PlatformDriverNotFoundError(targetTab.url);

    const platform = targetTab.platformId ?? undefined;
    const startedAt = Date.now();
    const report = (stage: "prepare" | "filling" | "submitted" | "generating" | "done") =>
      options.progress?.report({ stage, elapsedMs: Date.now() - startedAt, ...(platform ? { platform } : {}) });
    report("prepare");

    if (options.newChat) {
      await this.tabManager.startNewChat(targetTab, driver);
    }

    const sanitized = this.policyGate.sanitizeOutboundPrompt(options.prompt);
    return this.lockService.withLock(targetTab.targetId, async (lockHandle) => {
      let sessionHandle: SessionHandle | null = null;
      try {
        debug("lock acquired");
        sessionHandle = await withHostDeadline(
          this.browser.attach(targetTab.targetId),
          15_000,
          "Attaching to the tab did not complete.",
        );
        await withHostDeadline(
          this.browser.keepAliveInBackground(sessionHandle),
          5_000,
          "Background keep-alive did not complete.",
        );

        debug("attached");
        // A retry must not submit the same prompt twice. If the last user turn
        // already equals this prompt and an answer exists, return that answer.
        const duplicate = await this.findDuplicateTurn(sessionHandle, driver, sanitized.cleanText);
        if (duplicate) {
          report("done");
          // A retry must not append the same turn twice; only repair a ledger
          // that has no record of this conversation at all.
          if (this.threadStore && targetTab.platformId) {
            const key = targetTab.threadId ?? targetTab.targetId;
            if ((await this.threadStore.getTurns(key)).length === 0) {
              const userTurn: ConversationTurn = {
                turnIndex: 0,
                role: "user",
                markdownContent: sanitized.cleanText,
                codeBlocks: [],
                contentHash: String(sanitized.cleanText.length),
              };
              await this.threadStore.upsertThread({
                threadId: key,
                platform: targetTab.platformId,
                title: targetTab.title,
                url: targetTab.url,
                lastSyncedTurnCount: 2,
                updatedAt: new Date().toISOString(),
              });
              await this.threadStore.appendTurns(key, [userTurn, { ...duplicate, turnIndex: 1 }]);
            }
          }

          const duplicateArtifacts = this.artifactService
            ? this.artifactService.extractArtifacts(duplicate.markdownContent, duplicate.codeBlocks)
            : [];
          let duplicateFiles: string[] = [];
          if (options.writeFiles && this.fileSink && duplicateArtifacts.length > 0) {
            const res = await this.fileSink.persist(duplicateArtifacts, {
              outDir: options.outDir ?? "./artifacts",
              overwrite: true,
            });
            duplicateFiles = res.writtenFiles.map((file) => file.path);
          }
          return {
            tab: targetTab,
            turn: duplicate,
            elapsedMs: 0,
            riskLabels: this.policyGate.classifyInboundResponse(duplicate.markdownContent),
            redactedSecretsCount: sanitized.redactedCount,
            artifacts: duplicateArtifacts.length > 0 ? duplicateArtifacts : undefined,
            writtenFiles: duplicateFiles.length > 0 ? duplicateFiles : undefined,
            canvasDocument: null,
          };
        }

        if (options.toggles) {
          await driver.applyToggles(sessionHandle, this.browser, options.toggles);
        }

        const timeoutMs = options.timeoutMs ?? 120_000;
        report("filling");
        debug("submitting");
        const fingerprint = await withHostDeadline(
          driver.submitPrompt(sessionHandle, this.browser, sanitized.cleanText, options.files),
          timeoutMs,
          "Prompt submission did not complete.",
        );
        options.onSubmitted?.();
        report("submitted");
        report("generating");
        debug("submitted");
        const completion = await withHostDeadline(
          driver.awaitCompletion(sessionHandle, this.browser, fingerprint, timeoutMs),
          timeoutMs + 10_000,
          "Model generation did not settle in time.",
        );
        debug("completed");
        report("done");
        // Resolve the live URL before anything downstream records the thread;
        // the descriptor captured at tab-open time has no conversation id.
        const resolvedTab = await this.tabManager.captureConversation(targetTab, driver, sessionHandle);
        const currentTurn = options.autoContinue !== false
          ? await this.autoContinueTurn(sessionHandle, driver, completion.turn, timeoutMs, lockHandle)
          : completion.turn;

        const canvasDocument = driver.inspectCanvas ? await driver.inspectCanvas(sessionHandle, this.browser) : null;
        const artifacts = this.artifactService ? this.artifactService.extractArtifacts(currentTurn.markdownContent, currentTurn.codeBlocks) : [];
        let writtenFiles: string[] = [];

        if (options.writeFiles && this.fileSink && artifacts.length > 0) {
          const res = await this.fileSink.persist(artifacts, { outDir: options.outDir ?? "./artifacts", overwrite: true });
          writtenFiles = res.writtenFiles.map((f) => f.path);
        }

        this.journalService?.record({
          targetId: resolvedTab.targetId, platformId: resolvedTab.platformId,
          url: resolvedTab.url, threadId: resolvedTab.threadId, action: "ask",
        });

        if (this.threadStore && resolvedTab.platformId) {
          const key = resolvedTab.threadId ?? resolvedTab.targetId;
          const prevTurns = await this.threadStore.getTurns(key);
          const userTurn: ConversationTurn = {
            turnIndex: prevTurns.length, role: "user", markdownContent: sanitized.cleanText,
            codeBlocks: [], contentHash: String(sanitized.cleanText.length),
          };
          const assistantTurn: ConversationTurn = { ...currentTurn, turnIndex: prevTurns.length + 1 };
          await this.threadStore.upsertThread({
            threadId: key, platform: resolvedTab.platformId, title: resolvedTab.title,
            url: resolvedTab.url, lastSyncedTurnCount: prevTurns.length + 2, updatedAt: new Date().toISOString(),
          });
          await this.threadStore.appendTurns(key, [userTurn, assistantTurn]);
        }

        return {
          tab: resolvedTab, turn: currentTurn, elapsedMs: completion.elapsedMs,
          riskLabels: this.policyGate.classifyInboundResponse(currentTurn.markdownContent),
          redactedSecretsCount: sanitized.redactedCount,
          artifacts: artifacts.length > 0 ? artifacts : undefined,
          writtenFiles: writtenFiles.length > 0 ? writtenFiles : undefined,
          canvasDocument,
        };
      } catch (err) {
        if (targetTab.isNewlyCreated) {
          try { await this.tabManager.closeTab(targetTab.targetId); } catch {}
        }
        throw err;
      } finally {
        if (sessionHandle) await this.browser.detach(sessionHandle);
      }
    });
  }

  private async findDuplicateTurn(
    handle: SessionHandle,
    driver: PlatformPort,
    prompt: string,
  ): Promise<ConversationTurn | null> {
    const conversation = await Promise.race([
      driver.readThread(handle, this.browser, { lastNTurns: 4 }).catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    const turns = Array.isArray(conversation?.turns) ? conversation.turns : [];
    const lastUser = turns.map((turn, index) => ({ turn, index })).filter(({ turn }) => turn.role === "user").pop();
    if (!lastUser) return null;
    if (normalizePrompt(lastUser.turn.markdownContent) !== normalizePrompt(prompt)) return null;
    return turns.slice(lastUser.index + 1).find((turn) => turn.role === "assistant") ?? null;
  }

  private async autoContinueTurn(
    handle: SessionHandle, driver: PlatformPort, initial: ConversationTurn, timeoutMs: number, lockHandle?: LockHandle,
  ): Promise<ConversationTurn> {
    let current = initial;
    let count = 0;
    while (count < 5 && driver.findContinuationTrigger && driver.triggerContinuation) {
      if (lockHandle) await this.lockService.renewLock(lockHandle);
      const trigger = await driver.findContinuationTrigger(handle, this.browser);
      if (!trigger.hasContinuation) break;
      count++;
      await driver.triggerContinuation(handle, this.browser);
      const next = await driver.awaitCompletion(
        handle, this.browser, { turnCount: current.turnIndex + 1, lastTurnHash: String(current.turnIndex) }, timeoutMs,
      );
      current = { ...current, markdownContent: `${current.markdownContent}\n${next.turn.markdownContent}`, codeBlocks: [...current.codeBlocks, ...next.turn.codeBlocks] };
    }
    return current;
  }
}

/**
 * In-page completion detection relies on timers, and background tabs throttle
 * them. A host-side race guarantees the comparison settles even then.
 */
function withHostDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${message} (${Math.round(ms / 1000)}s)`)),
        ms,
      ),
    ),
  ]);
}

function normalizePrompt(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
