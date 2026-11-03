import type { BrowserPort, SessionHandle } from "../../core/ports/browser.port.js";
import type { TurnFingerprint } from "../../core/ports/platform.port.js";
import { buildMountedProbeExpr, buildQuietProbeExpr, buildReadyProbeExpr } from "./page-events.js";
import { isManagedTabRef } from "../browsers/tab-registry.js";
import { ConvoError, isConvoError } from "../../core/errors/convo-error.js";
import { TimeoutError } from "../../core/errors/bridge-errors.js";

/**
 * Universal background-safe visibility evaluation for Chromium.
 * Leverages native checkVisibility() with computed style cascading fallbacks.
 */
export const IS_VISIBLE_JS = `const isVisible = (el) => {
  if (!el || !el.isConnected) return false;
  if (el.hasAttribute('hidden')) return false;
  if (typeof el.checkVisibility === 'function') {
    return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
  }
  let cur = el;
  while (cur && cur !== document.body) {
    const s = window.getComputedStyle(cur);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
    cur = cur.parentElement;
  }
  return true;
};`;

const PROBE_TIMEOUT_MS = 3_000;
const POLL_MS = 120;
const QUIET_MS = 400;
const DEFAULT_SUBMIT_BUDGET_MS = 30_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function debug(message: string): void {
  if (process.env.CONVOLINK_DEBUG === "1") process.stderr.write(`[submit] ${message}\n`);
}

/** Resolves `undefined` instead of rejecting so a throttled tab cannot hang a caller. */
export async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise.catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

function remaining(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

async function probe<T>(browser: BrowserPort, handle: SessionHandle, expression: string): Promise<T | undefined> {
  return withDeadline(browser.evaluate<T>(handle, expression), PROBE_TIMEOUT_MS);
}

export async function waitForMounted(
  browser: BrowserPort,
  handle: SessionHandle,
  composerSelector: string,
  budgetMs: number,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  const probeExpr = buildMountedProbeExpr(composerSelector);
  while (Date.now() < deadline) {
    if ((await probe<boolean>(browser, handle, probeExpr)) === true) return true;
    await sleep(POLL_MS);
  }
  return false;
}

/**
 * Host-side hydration barrier. Two identical DOM fingerprints this far apart
 * mean the framework stopped re-rendering and its handlers are attached.
 */
export async function waitForDomQuiet(
  browser: BrowserPort,
  handle: SessionHandle,
  budgetMs: number,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  const probeExpr = buildQuietProbeExpr();
  let fingerprint = "";
  let stableSince = 0;

  while (Date.now() < deadline) {
    const sample = await probe<{ readyState?: string; nodes: number; text: number }>(browser, handle, probeExpr);
    if (sample && sample.readyState === "complete" && sample.nodes >= 0) {
      const next = `${sample.nodes}:${sample.text}`;
      if (next !== fingerprint) {
        fingerprint = next;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= QUIET_MS) {
        return true;
      }
    } else {
      fingerprint = "";
      stableSince = 0;
    }
    await sleep(POLL_MS);
  }
  return false;
}

/**
 * A freshly opened tab answers "composer exists" long before the framework has
 * hydrated its event handlers. Clicking then is ignored, which looks exactly
 * like a bot. This polls until a loaded document, a mounted composer, and an
 * enabled send control agree.
 */
async function waitForComposerReady(
  browser: BrowserPort,
  handle: SessionHandle,
  composerSelector: string,
  sendSelector: string,
  budgetMs: number,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  const probeExpr = buildReadyProbeExpr(composerSelector, sendSelector);
  while (Date.now() < deadline) {
    if ((await probe<boolean>(browser, handle, probeExpr)) === true) return true;
    await sleep(POLL_MS);
  }
  return false;
}

async function composerHasText(
  browser: BrowserPort,
  handle: SessionHandle,
  selector: string,
): Promise<boolean> {
  const result = await probe<boolean>(
    browser,
    handle,
    `(() => {
      const c = document.querySelector(${JSON.stringify(selector)});
      if (!c) return false;
      return (c.value || c.innerText || '').trim().length > 0;
    })()`,
  );
  return result === true;
}

async function waitForComposerEmpty(
  browser: BrowserPort,
  handle: SessionHandle,
  composerSelector: string,
  budgetMs: number,
): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (!(await composerHasText(browser, handle, composerSelector))) return true;
    await sleep(100);
  }
  return false;
}

/**
 * Activates send exactly once. Multiple synthetic activations (DOM click plus a
 * dispatched MouseEvent) submit the same prompt twice on platforms that do not
 * disable the button synchronously.
 *
 * Enter is used only when the composer still holds the text afterwards, which
 * means the click was ignored rather than pending.
 */
export async function waitForAndClickSendButton(
  browser: BrowserPort,
  handle: SessionHandle,
  sendBtnSelector: string,
  composerSelector: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  debug("waiting for ready");
  if (!(await waitForComposerReady(browser, handle, composerSelector, sendBtnSelector, remaining(deadline)))) {
    throw new ConvoError(
      "not-ready",
      `The send control (${sendBtnSelector}) never became enabled.`,
      "Retry the query; if it repeats, the platform layout may have changed and needs a selector update.",
      { retryable: true },
    );
  }

  await probe<boolean>(
    browser,
    handle,
    `(() => {
      const send = document.querySelector(${JSON.stringify(sendBtnSelector)});
      if (!send) return false;
      if (send.disabled || send.getAttribute('aria-disabled') === 'true' || send.classList.contains('ds-button--disabled')) return false;
      send.click();
      return true;
    })()`,
  );

  const clickWindow = Math.min(1500, Math.max(200, Math.floor(remaining(deadline) / 2)));
  debug("clicked; checking composer");
  if (await waitForComposerEmpty(browser, handle, composerSelector, clickWindow)) {
    debug("submitted after click");
    return;
  }

  // BiDi sends keys to the focused element, so focus the composer first.
  await probe<boolean>(
    browser,
    handle,
    `(() => {
      const c = document.querySelector(${JSON.stringify(composerSelector)});
      if (!c) return false;
      c.focus();
      return true;
    })()`,
  );

  debug("enter fallback");
  await browser.pressKey(handle, composerSelector, "Enter").catch(() => {});

  if (await waitForComposerEmpty(browser, handle, composerSelector, Math.min(2500, remaining(deadline)))) {
    debug("submitted after enter");
    return;
  }

  throw new ConvoError(
    "submission-failed",
    "Prompt stayed in the composer after one click and one Enter — submission was not observed.",
    "Retry the query; the platform may still be initializing the conversation.",
    { retryable: true },
  );
}

function isRecoverable(error: unknown): boolean {
  return isConvoError(error) && (error.code === "not-ready" || error.code === "submission-failed");
}

const NUDGE_EXPR = (composerSelector: string) => `(() => {
  const c = document.querySelector(${JSON.stringify(composerSelector)});
  if (!c) return false;
  c.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '' }));
  c.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

const RELOAD_EXPR = `(() => { location.reload(); return true; })()`;

async function promptVisible(browser: BrowserPort, handle: SessionHandle, marker: string): Promise<boolean> {
  return (await probe<boolean>(browser, handle, `(document.body.innerText || "").includes(${marker})`)) === true;
}

/**
 * Every platform's SPA can keep text in the composer without enabling its send
 * control. Recovery runs once, only while the whole submit still fits its
 * budget, and only after confirming the prompt never reached the conversation —
 * a late submit must not be duplicated.
 */
export async function submitWithRecovery(
  browser: BrowserPort,
  handle: SessionHandle,
  composerSelector: string,
  sendBtnSelector: string,
  prompt: string,
  timeoutMs = DEFAULT_SUBMIT_BUDGET_MS,
  nudgeMs = 4_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Recovery needs budget of its own. Without a reserve the first readiness
  // wait consumes the whole deadline and the reload can never run.
  const primaryDeadline = deadline - Math.floor(timeoutMs * 0.4);

  try {
    await waitForAndClickSendButton(browser, handle, sendBtnSelector, composerSelector, remaining(primaryDeadline));
    return;
  } catch (error) {
    if (!isRecoverable(error)) throw error;
  }

  debug("recovery: checking whether prompt already landed");
  const marker = JSON.stringify(prompt.trim().slice(0, 80));
  if (await promptVisible(browser, handle, marker)) return;

  debug("recovery: nudge");
  await probe<boolean>(browser, handle, NUDGE_EXPR(composerSelector));
  try {
    await waitForAndClickSendButton(
      browser,
      handle,
      sendBtnSelector,
      composerSelector,
      Math.min(nudgeMs, remaining(deadline)),
    );
    return;
  } catch (error) {
    if (!isRecoverable(error)) throw error;
    if (await promptVisible(browser, handle, marker)) return;
  }

  if (remaining(deadline) < 250) {
    throw new ConvoError(
      "not-ready",
      "The composer never became ready and the submit budget was exhausted before recovery could run.",
      "Retry the query; a slow first paint is usually transient.",
      { retryable: true },
    );
  }

  const currentUrl = await probe<string>(browser, handle, "location.href");
  const owned =
    typeof currentUrl === "string"
      ? isManagedTabRef({ targetId: handle.targetId, url: currentUrl, threadId: null })
      : false;
  if (!owned) {
    throw new ConvoError(
      "not-ready",
      "The conversation is open in a tab ConvoLink does not own, and reloading it would discard the user's state.",
      "Reload that tab manually, or re-run with a thread URL so ConvoLink opens its own tab.",
      { retryable: true },
    );
  }

  debug("recovery: reload");
  await probe<boolean>(browser, handle, RELOAD_EXPR);
  if (!(await waitForMounted(browser, handle, composerSelector, Math.max(1000, remaining(deadline) - 5_000)))) {
    throw new ConvoError(
      "not-ready",
      "The page did not recover after an automatic reload.",
      "Reload the tab manually, then retry the query.",
      { retryable: true },
    );
  }

  debug("recovery: refilling");
  await browser.fillText(handle, composerSelector, prompt);
  debug("recovery: resubmitting");
  await waitForAndClickSendButton(browser, handle, sendBtnSelector, composerSelector, remaining(deadline));
}

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
  const text = completionText(status);
  return Boolean(status.hasNewTurn || (text.length > 0 && text !== before.lastTurnHash));
}

export interface SettleResult<T> {
  readonly status: T;
  readonly elapsedMs: number;
  readonly timedOut: boolean;
}

/**
 * Host-side settle loop. In-page waits are impossible to bound reliably in a
 * throttled background tab, so every driver polls a short immediate probe and
 * decides quiescence here.
 */
export async function pollUntilSettled(
  browser: BrowserPort,
  handle: SessionHandle,
  probeExpr: string,
  options: {
    readonly timeoutMs: number;
    readonly quiescenceMs: number;
    readonly textOf: (status: CompletionProbeStatus) => string;
    readonly isNew: (status: CompletionProbeStatus) => boolean;
  },
): Promise<SettleResult<CompletionProbeStatus>> {
  const start = Date.now();
  const deadline = start + options.timeoutMs;
  let lastStatus: CompletionProbeStatus | undefined;
  let lastText = "";
  let lastChange = start;
  let lastDebug = 0;

  while (Date.now() < deadline) {
    const status = await probe<CompletionProbeStatus>(browser, handle, probeExpr);
    if (status) {
      lastStatus = status;
      const text = options.textOf(status);
      if (status.isGenerating || status.isThinking || text.length !== lastText.length) {
        lastChange = Date.now();
        lastText = text;
      }
      if (process.env.CONVOLINK_DEBUG === "1" && Date.now() - lastDebug > 3000) {
        lastDebug = Date.now();
        process.stderr.write(
          `[settle] turns=${status.turnsCount ?? status.turnIndex ?? status.mdCount ?? "?"} new=${Boolean(status.hasNewTurn)} generating=${Boolean(status.isGenerating)} thinking=${Boolean(status.isThinking)} text=${options.textOf(status).length}\n`,
        );
      }
      if (options.isNew(status) && !status.isGenerating && !status.isThinking && Date.now() - lastChange >= options.quiescenceMs) {
        return { status, elapsedMs: Date.now() - start, timedOut: false };
      }
    }
    await sleep(POLL_MS);
  }

  if (!lastStatus) throw new TimeoutError("The page did not answer status probes.", options.timeoutMs);
  return { status: lastStatus, elapsedMs: Date.now() - start, timedOut: true };
}
