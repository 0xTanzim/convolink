/**
 * In-page wait expressions. Both transports support awaiting a promise
 * (CDP `awaitPromise`, BiDi `awaitPromise`), so the wait happens next to the DOM
 * and the agent is notified on the event instead of polling over the wire.
 */

export interface SettleOptions {
  readonly quiescenceMs?: number;
  readonly maxWaitMs?: number;
}

const DEFAULT_QUIESCENCE_MS = 400;
const DEFAULT_MAX_WAIT_MS = 120_000;

/**
 * Wraps a status expression so it resolves only once the page has been quiet for
 * `quiescenceMs`, nothing is generating or thinking, and a new turn exists.
 * Returns the last status plus `timedOut`, so callers keep a bounded wait.
 */
export function buildSettleExpr(statusExpr: string, options: SettleOptions = {}): string {
  const quiescenceMs = options.quiescenceMs ?? DEFAULT_QUIESCENCE_MS;
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;

  return `(() => new Promise((resolve) => {
    const statusOf = () => (${statusExpr});
    const startedAt = Date.now();
    let lastChange = Date.now();
    let lastSnapshot = "";
    const observer = new MutationObserver(() => { lastChange = Date.now(); });
    try {
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
    } catch {}

    const finish = (status, timedOut) => {
      try { observer.disconnect(); } catch {}
      clearInterval(poll);
      resolve({ ...status, timedOut });
    };

    const poll = setInterval(() => {
      const status = statusOf();
      const snapshot = JSON.stringify(status);
      if (snapshot !== lastSnapshot) {
        lastSnapshot = snapshot;
        lastChange = Date.now();
      }
      const generating = Boolean(status.isGenerating || status.isThinking);
      const quiet = Date.now() - lastChange >= ${quiescenceMs};
      if (quiet && !generating) return finish(status, false);
      if (Date.now() - startedAt >= ${maxWaitMs}) return finish(status, true);
    }, 80);
  }))()`;
}

export interface ReadyOptions {
  /** Consecutive stable samples before reporting ready. */
  readonly stableSamples?: number;
  readonly maxWaitMs?: number;
}

/**
 * Resolves true only when the document finished loading, the composer is
 * mounted, and the send control is enabled and stays that way. This is what
 * keeps a freshly opened tab from being treated as ready.
 */
export function buildReadyExpr(
  composerSelector: string,
  sendSelector: string,
  options: ReadyOptions = {},
): string {
  const stableSamples = options.stableSamples ?? 2;
  const maxWaitMs = options.maxWaitMs ?? 15_000;

  return `(() => new Promise((resolve) => {
    const composerSelector = ${JSON.stringify(composerSelector)};
    const sendSelector = ${JSON.stringify(sendSelector)};
    const startedAt = Date.now();
    let stable = 0;

    const probe = () => {
      if (document.readyState !== "complete") return false;
      if (!document.querySelector(composerSelector)) return false;
      const send = document.querySelector(sendSelector);
      if (!send) return false;
      return !(send.disabled || send.getAttribute("aria-disabled") === "true" || send.classList.contains("ds-button--disabled"));
    };

    const timer = setInterval(() => {
      stable = probe() ? stable + 1 : 0;
      if (stable >= ${stableSamples}) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= ${maxWaitMs}) {
        clearInterval(timer);
        resolve(false);
      }
    }, 120);
  }))()`;
}

export interface MountOptions {
  readonly stableSamples?: number;
  readonly maxWaitMs?: number;
}

/**
 * Readiness for "the tab is usable", not "the tab can send". Several platforms
 * only render their send control after the composer gets content, so requiring
 * it here made tab creation wait for a selector that appears much later.
 */
export function buildMountedExpr(composerSelector: string, options: MountOptions = {}): string {
  const stableSamples = options.stableSamples ?? 2;
  const maxWaitMs = options.maxWaitMs ?? 20_000;

  return `(() => new Promise((resolve) => {
    const composerSelector = ${JSON.stringify(composerSelector)};
    const startedAt = Date.now();
    let stable = 0;

    const probe = () => document.readyState === "complete" && Boolean(document.querySelector(composerSelector));

    const timer = setInterval(() => {
      stable = probe() ? stable + 1 : 0;
      if (stable >= ${stableSamples}) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt >= ${maxWaitMs}) {
        clearInterval(timer);
        resolve(false);
      }
    }, 120);
  }))()`;
}

/**
 * Mounted is not hydrated. Typing between "composer exists" and "framework
 * attached its handlers" leaves text the app never sees, so submission never
 * enables. Wait for the composer plus a quiet DOM window.
 */
export function buildHydratedExpr(
  composerSelector: string,
  options: { readonly quietMs?: number; readonly maxWaitMs?: number } = {},
): string {
  const quietMs = options.quietMs ?? 400;
  const maxWaitMs = options.maxWaitMs ?? 20_000;

  return `(() => new Promise((resolve) => {
    const composerSelector = ${JSON.stringify(composerSelector)};
    const startedAt = Date.now();
    let mountedAt = 0;
    let lastMutation = Date.now();

    const observer = new MutationObserver(() => {
      if (mountedAt > 0) lastMutation = Date.now();
    });
    observer.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true, attributes: true,
    });

    const timer = setInterval(() => {
      if (mountedAt === 0 && document.querySelector(composerSelector)) {
        mountedAt = Date.now();
        lastMutation = Date.now();
      }
      if (mountedAt > 0 && Date.now() - lastMutation >= ${quietMs}) {
        clearInterval(timer); observer.disconnect(); resolve(true); return;
      }
      if (Date.now() - startedAt >= ${maxWaitMs}) {
        clearInterval(timer); observer.disconnect(); resolve(false);
      }
    }, 100);
  }))()`;
}

/** Immediate boolean probe. Never returns a promise, so it cannot block the socket. */
export function buildMountedProbeExpr(composerSelector: string): string {
  return `(() => document.readyState === "complete" && Boolean(document.querySelector(${JSON.stringify(composerSelector)})))()`;
}

/**
 * Immediate readiness probe. Polled from the host because a background tab
 * throttles `setInterval`, which makes any in-page wait unreliable and keeps
 * the single BiDi socket busy until it eventually resolves.
 */
export function buildReadyProbeExpr(composerSelector: string, sendSelector: string): string {
  return `(() => {
    if (document.readyState !== "complete") return false;
    if (!document.querySelector(${JSON.stringify(composerSelector)})) return false;
    const send = document.querySelector(${JSON.stringify(sendSelector)});
    if (!send) return false;
    return !(send.disabled || send.getAttribute("aria-disabled") === "true" || send.classList.contains("ds-button--disabled"));
  })()`;
}

/**
 * Cheap structural fingerprint. Two identical samples a few hundred
 * milliseconds apart are the host-side equivalent of "the SPA stopped
 * re-rendering", without depending on page timers.
 */
export function buildQuietProbeExpr(): string {
  return `(() => {
    if (document.readyState !== "complete") return { readyState: document.readyState, nodes: -1, text: -1 };
    return {
      readyState: document.readyState,
      nodes: document.querySelectorAll("*").length,
      text: (document.body && document.body.innerText ? document.body.innerText.length : 0),
    };
  })()`;
}

/** Turns a status expression into an immediate probe instead of a page promise. */
export function buildStatusProbeExpr(statusExpr: string): string {
  return `(() => (${statusExpr})())`;
}
