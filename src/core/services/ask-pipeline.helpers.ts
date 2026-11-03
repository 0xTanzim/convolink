import type { BrowserPort, SessionHandle } from "../ports/browser.port.js";
import type { PlatformPort, ConversationTurn } from "../ports/platform.port.js";
import type { ThreadStore, WorkspaceSinkPort } from "../ports/storage.port.js";
import type { PolicyGatePort } from "../ports/policy.port.js";
import type { LockHandle, LockService } from "./lock.service.js";
import type { ArtifactService } from "./artifact.service.js";
import type { AskOptions, AskResult, DiscoveredTab } from "./orchestrator.types.js";

export function withHostDeadline<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${message} (${Math.round(ms / 1000)}s)`)), ms)),
  ]);
}

export async function findDuplicateTurn(
  browser: BrowserPort,
  handle: SessionHandle,
  driver: PlatformPort,
  prompt: string,
): Promise<ConversationTurn | null> {
  const normalizePrompt = (text: string) => text.trim().replace(/\s+/g, " ");
  const res = await withHostDeadline(
    driver.readThread(handle, browser, { lastNTurns: 4 }),
    5_000,
    "Reading thread for duplicate check timed out.",
  ).catch(() => ({ turns: [] as ConversationTurn[] }));

  const turns = (res && Array.isArray(res.turns)) ? res.turns : [];
  const lastUser = turns.map((turn, index) => ({ turn, index })).filter(({ turn }) => turn.role === "user").pop();
  if (!lastUser) return null;
  if (normalizePrompt(lastUser.turn.markdownContent) !== normalizePrompt(prompt)) return null;
  return turns.slice(lastUser.index + 1).find((turn) => turn.role === "assistant") ?? null;
}

export async function autoContinueTurn(
  deps: { browser: BrowserPort; lockService: LockService },
  handle: SessionHandle,
  driver: PlatformPort,
  initial: ConversationTurn,
  timeoutMs: number,
  lockHandle?: LockHandle,
): Promise<ConversationTurn> {
  let current = initial;
  let count = 0;
  while (count < 5 && driver.findContinuationTrigger && driver.triggerContinuation) {
    if (lockHandle) await deps.lockService.renewLock(lockHandle);
    const trigger = await driver.findContinuationTrigger(handle, deps.browser);
    if (!trigger.hasContinuation) break;
    count++;
    await driver.triggerContinuation(handle, deps.browser);
    const next = await driver.awaitCompletion(
      handle, deps.browser, { turnCount: current.turnIndex + 1, lastTurnHash: String(current.turnIndex) }, timeoutMs,
    );
    const nextText = next.turn.markdownContent;
    const currentText = current.markdownContent;
    const mergedText = (nextText.startsWith(currentText.trim()) || nextText.startsWith(currentText))
      ? nextText
      : `${currentText}\n${nextText}`;
    const mergedCodeBlocks = (next.turn.codeBlocks.length >= current.codeBlocks.length && next.turn.codeBlocks.length > 0)
      ? next.turn.codeBlocks
      : [...current.codeBlocks, ...next.turn.codeBlocks];
    current = { ...current, markdownContent: mergedText, codeBlocks: mergedCodeBlocks };
  }
  return current;
}

export async function persistTurns(
  store: ThreadStore | undefined,
  tab: DiscoveredTab,
  cleanPrompt: string,
  currentTurn: ConversationTurn,
): Promise<void> {
  if (!store || !tab.platformId) return;
  const key = tab.threadId ?? tab.targetId;
  const prevTurns = await store.getTurns(key);
  const userTurn: ConversationTurn = {
    turnIndex: prevTurns.length, role: "user", markdownContent: cleanPrompt,
    codeBlocks: [], contentHash: String(cleanPrompt.length),
  };
  const assistantTurn: ConversationTurn = { ...currentTurn, turnIndex: prevTurns.length + 1 };
  await store.upsertThread({
    threadId: key, platform: tab.platformId, title: tab.title,
    url: tab.url, lastSyncedTurnCount: prevTurns.length + 2, updatedAt: new Date().toISOString(),
  });
  await store.appendTurns(key, [userTurn, assistantTurn]);
}

export async function recordDuplicateInStore(
  store: ThreadStore | undefined,
  tab: DiscoveredTab,
  duplicate: ConversationTurn,
  cleanPrompt: string,
): Promise<void> {
  if (!store || !tab.platformId) return;
  const key = tab.threadId ?? tab.targetId;
  if ((await store.getTurns(key)).length === 0) {
    const userTurn: ConversationTurn = {
      turnIndex: 0, role: "user", markdownContent: cleanPrompt,
      codeBlocks: [], contentHash: String(cleanPrompt.length),
    };
    await store.upsertThread({
      threadId: key, platform: tab.platformId, title: tab.title, url: tab.url,
      lastSyncedTurnCount: 2, updatedAt: new Date().toISOString(),
    });
    await store.appendTurns(key, [userTurn, { ...duplicate, turnIndex: 1 }]);
  }
}

export async function buildDuplicateResult(
  deps: { artifactService?: ArtifactService; fileSink?: WorkspaceSinkPort; policyGate: PolicyGatePort },
  tab: DiscoveredTab,
  duplicate: ConversationTurn,
  sanitized: { cleanText: string; redactedCount: number },
  options: AskOptions,
): Promise<AskResult> {
  const duplicateArtifacts = deps.artifactService
    ? deps.artifactService.extractArtifacts(duplicate.markdownContent, duplicate.codeBlocks)
    : [];
  let duplicateFiles: string[] = [];
  if (options.writeFiles && deps.fileSink && duplicateArtifacts.length > 0) {
    const res = await deps.fileSink.persist(duplicateArtifacts, { outDir: options.outDir ?? "./artifacts", overwrite: true });
    duplicateFiles = res.writtenFiles.map((file) => file.path);
  }
  return {
    tab, turn: duplicate, elapsedMs: 0,
    riskLabels: deps.policyGate.classifyInboundResponse(duplicate.markdownContent),
    redactedSecretsCount: sanitized.redactedCount,
    artifacts: duplicateArtifacts.length > 0 ? duplicateArtifacts : undefined,
    writtenFiles: duplicateFiles.length > 0 ? duplicateFiles : undefined,
  };
}
