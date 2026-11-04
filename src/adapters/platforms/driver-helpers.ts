import type { BrowserPort, SessionHandle } from "../../core/ports/browser.port.js";
import { buildMountedProbeExpr, buildQuietProbeExpr } from "./page-events.js";

export * from "./settle-poll.js";
export * from "./driver-submit.js";

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

export const PROBE_TIMEOUT_MS = 8_000;
export const POLL_MS = 120;
export const QUIET_MS = 400;

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function remaining(deadline: number): number {
  return Math.max(0, deadline - Date.now());
}

/** Resolves `undefined` instead of rejecting so a throttled tab cannot hang a caller. */
export async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise.catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

export async function probe<T>(
  browser: BrowserPort,
  handle: SessionHandle,
  expression: string,
  onError?: (error: unknown) => void,
): Promise<T | undefined> {
  const evaluation = browser.evaluate<T>(handle, expression);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), PROBE_TIMEOUT_MS);
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
