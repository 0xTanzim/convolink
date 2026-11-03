import type { BrowserPort, SessionHandle } from "../ports/browser.port.js";
import type { PlatformPort } from "../ports/platform.port.js";
import type { PolicyGatePort } from "../ports/policy.port.js";
import type { ThreadStore, WorkspaceSinkPort } from "../ports/storage.port.js";
import type { LockService } from "./lock.service.js";
import type { ArtifactService } from "./artifact.service.js";
import type { StateJournalService } from "./journal.service.js";
import type { TabManagerService } from "./tab-manager.service.js";
import { TabResolver } from "./tab-resolver.js";
import { PlatformDriverNotFoundError } from "../errors/bridge-errors.js";
import type { AskOptions, AskResult, DiscoveredTab } from "./orchestrator.types.js";
import {
  withHostDeadline,
  findDuplicateTurn,
  autoContinueTurn,
  persistTurns,
  recordDuplicateInStore,
  buildDuplicateResult,
} from "./ask-pipeline.helpers.js";

export interface AskPipelineDependencies {
  readonly browser: BrowserPort;
  readonly drivers: readonly PlatformPort[];
  readonly lockService: LockService;
  readonly policyGate: PolicyGatePort;
  readonly tabManager: TabManagerService;
  readonly artifactService?: ArtifactService;
  readonly fileSink?: WorkspaceSinkPort;
  readonly journalService?: StateJournalService;
  readonly threadStore?: ThreadStore;
  readonly listTabs: () => Promise<DiscoveredTab[]>;
}

export class AskPipelineService {
  constructor(private readonly deps: AskPipelineDependencies) {}

  public async execute(options: AskOptions): Promise<AskResult> {
    const debug = (msg: string) => {
      if (process.env.CONVOLINK_DEBUG === "1") process.stderr.write(`[ask] ${msg}\n`);
    };
    debug("start");
    const tabs = await this.deps.listTabs();
    const targetTab = await this.deps.tabManager.resolveOrAutoOpenTab(options, tabs);
    debug(`tab ${targetTab.targetId}`);

    const driver = TabResolver.findDriver(targetTab.url, this.deps.drivers);
    if (!driver) throw new PlatformDriverNotFoundError(targetTab.url);

    const platform = targetTab.platformId ?? undefined;
    const startedAt = Date.now();
    const report = (stage: "prepare" | "filling" | "submitted" | "generating" | "done") =>
      options.progress?.report({ stage, elapsedMs: Date.now() - startedAt, ...(platform ? { platform } : {}) });
    report("prepare");

    if (options.newChat) {
      await this.deps.tabManager.startNewChat(targetTab, driver);
    }

    const sanitized = this.deps.policyGate.sanitizeOutboundPrompt(options.prompt);
    try {
      return await this.deps.lockService.withLock(targetTab.targetId, async (lockHandle) => {
        let sessionHandle: SessionHandle | null = null;
        try {
          debug("lock acquired");
          sessionHandle = await withHostDeadline(
            this.deps.browser.attach(targetTab.targetId), 15_000, "Attaching to the tab did not complete.",
          );
          await withHostDeadline(
            this.deps.browser.keepAliveInBackground(sessionHandle), 5_000, "Background keep-alive did not complete.",
          );

          debug("attached");
          debug("duplicate-check");
          const duplicate = targetTab.isNewlyCreated
            ? null
            : await findDuplicateTurn(this.deps.browser, sessionHandle, driver, sanitized.cleanText);
          if (duplicate) {
            debug("duplicate-found");
            report("done");
            await recordDuplicateInStore(this.deps.threadStore, targetTab, duplicate, sanitized.cleanText);
            return buildDuplicateResult(this.deps, targetTab, duplicate, sanitized, options);
          }

          if (options.toggles && driver.applyToggles) {
            await driver.applyToggles(sessionHandle, this.deps.browser, options.toggles);
          }

          report("filling");
          debug("submitting");
          const fingerprint = await driver.submitPrompt(sessionHandle, this.deps.browser, sanitized.cleanText);
          debug("submitted");
          report("submitted");

          const timeoutMs = options.timeoutMs ?? 300_000;
          report("generating");
          debug("awaiting-completion");
          const completion = await withHostDeadline(
            driver.awaitCompletion(sessionHandle, this.deps.browser, fingerprint, timeoutMs),
            timeoutMs + 10_000,
            "Model generation did not settle in time.",
          );
          debug("completed");
          report("done");

          const resolvedTab = await this.deps.tabManager.captureConversation(targetTab, driver, sessionHandle);
          const currentTurn = options.autoContinue !== false
            ? await autoContinueTurn(this.deps, sessionHandle, driver, completion.turn, timeoutMs, lockHandle)
            : completion.turn;

          const canvasDocument = driver.inspectCanvas ? await driver.inspectCanvas(sessionHandle, this.deps.browser) : null;
          const artifacts = this.deps.artifactService ? this.deps.artifactService.extractArtifacts(currentTurn.markdownContent, currentTurn.codeBlocks) : [];
          let writtenFiles: string[] = [];

          if (options.writeFiles && this.deps.fileSink && artifacts.length > 0) {
            const res = await this.deps.fileSink.persist(artifacts, { outDir: options.outDir ?? "./artifacts", overwrite: true });
            writtenFiles = res.writtenFiles.map((f) => f.path);
          }

          this.deps.journalService?.record({
            targetId: resolvedTab.targetId, platformId: resolvedTab.platformId,
            url: resolvedTab.url, threadId: resolvedTab.threadId, action: "ask",
          });

          await persistTurns(this.deps.threadStore, resolvedTab, sanitized.cleanText, currentTurn);

          return {
            tab: resolvedTab,
            turn: currentTurn,
            elapsedMs: completion.elapsedMs,
            riskLabels: this.deps.policyGate.classifyInboundResponse(currentTurn.markdownContent),
            redactedSecretsCount: sanitized.redactedCount,
            artifacts: artifacts.length > 0 ? artifacts : undefined,
            writtenFiles: writtenFiles.length > 0 ? writtenFiles : undefined,
            canvasDocument,
          };
        } finally {
          if (sessionHandle) await this.deps.browser.detach(sessionHandle);
        }
      });
    } catch (err) {
      if (targetTab.isNewlyCreated) {
        await this.deps.tabManager.closeTab(targetTab.targetId).catch(() => {});
      }
      throw err;
    }
  }
}
