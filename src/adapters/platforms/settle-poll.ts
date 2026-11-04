import type { BrowserPort, SessionHandle } from "../../core/ports/browser.port.js";
import type { TurnFingerprint } from "../../core/ports/platform.port.js";
import { TimeoutError } from "../../core/errors/bridge-errors.js";

const POLL_MS = 120;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface CompletionProbeStatus {
  readonly turnsCount?: number;
  readonly turnIndex?: number;
  readonly mdCount?: number;
  readonly hasNewTurn?: boolean;
  readonly isGenerating?: boolean;
  readonly isThinking?: boolean;
  readonly assistantText?: string;
  readonly text?: string;
  readonly codeBlocks?: Array<{ language: string; code: string }>;
}

export function completionText(status: CompletionProbeStatus): string {
  return status.assistantText ?? status.text ?? "";
}

export function hasNewCompletion(status: CompletionProbeStatus, before: TurnFingerprint): boolean {
  if (typeof status.hasNewTurn === "boolean") {
    return status.hasNewTurn;
  }
  const currentCount = status.turnsCount ?? status.turnIndex ?? status.mdCount;
  if (typeof currentCount === "number") {
    return currentCount > before.turnCount;
  }
  return false;
}

export interface SettleOptions {
  readonly timeoutMs: number;
  readonly quiescenceMs: number;
  readonly watchdogIntervalMs?: number;
  readonly textOf: (status: CompletionProbeStatus) => string;
  readonly isNew: (status: CompletionProbeStatus) => boolean;
}

export interface SettleResult<T> {
  readonly status: T;
  readonly elapsedMs: number;
  readonly timedOut: boolean;
}

/**
 * Host-side settle loop. In-page waits are impossible to bound reliably in a
 * throttled background tab, so every driver polls a short immediate probe and
 * decides quiescence here. Periodic background keepAlive nudges prevent rAF freezing.
 */
export async function pollUntilSettled(
  browser: BrowserPort,
  handle: SessionHandle,
  probeExpr: string,
  options: SettleOptions,
): Promise<SettleResult<CompletionProbeStatus>> {
  const start = Date.now();
  const deadline = start + options.timeoutMs;
  const watchdogIntervalMs = options.watchdogIntervalMs ?? 3_000;

  // Initial nudge to wake background rendering pipeline
  await browser.keepAliveInBackground(handle).catch(() => undefined);

  let lastStatus: CompletionProbeStatus | undefined;
  let lastText = "";
  let lastChange = start;
  let lastKeepAlive = start;
  let lastDebug = 0;
  let lastProbeError: unknown;
  let consecutiveErrors = 0;

  while (Date.now() < deadline) {
    // Periodic watchdog nudge when content growth stalls
    const now = Date.now();
    if (now - lastChange >= watchdogIntervalMs && now - lastKeepAlive >= watchdogIntervalMs) {
      lastKeepAlive = now;
      await browser.keepAliveInBackground(handle).catch(() => undefined);
    }

    const status = await probeStatus(browser, handle, probeExpr, (error) => {
      lastProbeError = error;
      consecutiveErrors += 1;
    });

    if (status) consecutiveErrors = 0;
    if (!status && consecutiveErrors >= 5) {
      const detail = lastProbeError instanceof Error ? lastProbeError.message : String(lastProbeError ?? "unknown error");
      throw new Error(`Status probe failed repeatedly: ${detail}`);
    }

    if (status) {
      lastStatus = status;
      const text = options.textOf(status);
      if (status.isGenerating || text.length !== lastText.length) {
        lastChange = Date.now();
      }
      lastText = text;

      if (process.env.CONVOLINK_DEBUG === "1" && Date.now() - lastDebug > 3000) {
        lastDebug = Date.now();
        process.stderr.write(
          `[settle] turns=${status.turnsCount ?? status.turnIndex ?? status.mdCount ?? "?"} new=${Boolean(status.hasNewTurn)} generating=${Boolean(status.isGenerating)} thinking=${Boolean(status.isThinking)} text=${options.textOf(status).length}\n`,
        );
      }

      const stableFor = Date.now() - lastChange;
      const thinkingActive = Boolean(status.isThinking) && stableFor < Math.max(options.quiescenceMs, 1_200);
      const hasText = text.trim().length > 0;
      if (hasText && options.isNew(status) && !status.isGenerating && !thinkingActive && stableFor >= options.quiescenceMs) {
        return { status, elapsedMs: Date.now() - start, timedOut: false };
      }
    }
    await sleep(POLL_MS);
  }

  if (!lastStatus) {
    const detail = lastProbeError instanceof Error ? ` Last error: ${lastProbeError.message}` : "";
    throw new TimeoutError(`The page did not answer status probes.${detail}`, options.timeoutMs);
  }
  return { status: lastStatus, elapsedMs: Date.now() - start, timedOut: true };
}

async function probeStatus(
  browser: BrowserPort,
  handle: SessionHandle,
  expression: string,
  onError?: (error: unknown) => void,
): Promise<CompletionProbeStatus | undefined> {
  const evaluation = browser.evaluate<CompletionProbeStatus>(handle, expression);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), 8_000);
  });
  try {
    return await Promise.race([evaluation, deadline]);
  } catch (error) {
    onError?.(error);
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
    void evaluation.catch(() => undefined);
  }
}
