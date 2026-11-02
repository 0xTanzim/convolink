import type { BrowserPort, SessionHandle } from "../../core/ports/browser.port.js";
import { buildMountedExpr, buildReadyExpr } from "./page-events.js";
import { ConvoError, isConvoError } from "../../core/errors/convo-error.js";

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

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * A freshly opened tab answers "composer exists" long before the framework has
 * hydrated its event handlers. Clicking then is ignored, which looks exactly
 * like a bot. This waits for a fully loaded document, a mounted composer, and an
 * enabled send control that stays that way for consecutive polls.
 */
async function waitForComposerReady(
  browser: BrowserPort,
  handle: SessionHandle,
  composerSelector: string,
  sendSelector: string,
  timeoutMs: number,
): Promise<boolean> {
  // One round trip: the page itself resolves when the composer is mounted and
  // the send control is enabled and stable.
  const ready = await browser
    .evaluate<unknown>(handle, buildReadyExpr(composerSelector, sendSelector, { maxWaitMs: timeoutMs }))
    .catch(() => false);
  return ready === true;
}

async function composerHasText(
  browser: BrowserPort,
  handle: SessionHandle,
  selector: string,
): Promise<boolean> {
  const result = await browser.evaluate<unknown>(
    handle,
    `(() => {
      const c = document.querySelector(${JSON.stringify(selector)});
      if (!c) return false;
      return (c.value || c.innerText || '').trim().length > 0;
    })()`,
  ).catch(() => false);
  return result === true;
}

/**
 * Activates send exactly once. Multiple synthetic activations (DOM click plus a
 * dispatched MouseEvent, or a second port click) submit the same prompt twice on
 * platforms that do not disable the button synchronously.
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
  const ready = await waitForComposerReady(browser, handle, composerSelector, sendBtnSelector, timeoutMs);
  if (!ready) {
    throw new ConvoError(
      "not-ready",
      `The send control (${sendBtnSelector}) never became enabled.`,
      "Retry the query; if it repeats, the platform layout may have changed and needs a selector update.",
      { retryable: true },
    );
  }

  await browser.evaluate(
    handle,
    `(() => {
      const send = document.querySelector(${JSON.stringify(sendBtnSelector)});
      if (!send) return false;
      if (send.disabled || send.getAttribute('aria-disabled') === 'true' || send.classList.contains('ds-button--disabled')) return false;
      send.click();
      return true;
    })()`,
  ).catch(() => {});

  // Poll instead of assuming a fixed delay: under parallel load the click can
  // land before the platform has attached its submit handler.
  if (await waitForComposerEmpty(browser, handle, composerSelector, 2000)) return;

  // BiDi sends keys to the focused element, so focus the composer first.
  await browser.evaluate(
    handle,
    `(() => {
      const c = document.querySelector(${JSON.stringify(composerSelector)});
      if (!c) return false;
      c.focus();
      return true;
    })()`,
  ).catch(() => false);

  await browser.pressKey(handle, composerSelector, "Enter").catch(() => {});

  if (await waitForComposerEmpty(browser, handle, composerSelector, 2500)) return;

  throw new ConvoError(
    "submission-failed",
    "Prompt stayed in the composer after one click and one Enter — submission was not observed.",
    "Retry the query; the platform may still be initializing the conversation.",
    { retryable: true },
  );
}

async function waitForComposerEmpty(
  browser: BrowserPort,
  handle: SessionHandle,
  composerSelector: string,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await composerHasText(browser, handle, composerSelector))) return true;
    await sleep(100);
  }
  return false;
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

/**
 * Gemini's SPA occasionally keeps text in the composer without enabling its
 * send control; the only reliable cure is a reload. Recovery runs at most once,
 * and only when the prompt never reached the conversation, so a late submit
 * cannot be duplicated.
 */
export async function submitWithRecovery(
  browser: BrowserPort,
  handle: SessionHandle,
  composerSelector: string,
  sendBtnSelector: string,
  prompt: string,
  timeoutMs = 20_000,
  nudgeMs = 3000,
): Promise<void> {
  try {
    await waitForAndClickSendButton(browser, handle, sendBtnSelector, composerSelector, timeoutMs);
    return;
  } catch (error) {
    if (!isRecoverable(error)) throw error;
  }

  const marker = JSON.stringify(prompt.trim().slice(0, 80));
  if (await promptVisible(browser, handle, marker)) return;

  await browser.evaluate(handle, NUDGE_EXPR(composerSelector)).catch(() => false);
  try {
    await waitForAndClickSendButton(browser, handle, sendBtnSelector, composerSelector, nudgeMs);
    return;
  } catch (error) {
    if (!isRecoverable(error)) throw error;
    if (await promptVisible(browser, handle, marker)) return;
  }

  await browser.evaluate(handle, "(() => { location.reload(); return true; })()").catch(() => false);

  const remounted = await browser
    .evaluate<unknown>(handle, buildMountedExpr(composerSelector, { maxWaitMs: 20_000 }))
    .catch(() => false);
  if (remounted !== true) {
    throw new ConvoError(
      "not-ready",
      "The page did not recover after an automatic reload.",
      "Reload the tab manually, then retry the query.",
      { retryable: true },
    );
  }

  await browser.fillText(handle, composerSelector, prompt);
  await waitForAndClickSendButton(browser, handle, sendBtnSelector, composerSelector, timeoutMs);
}

async function promptVisible(browser: BrowserPort, handle: SessionHandle, marker: string): Promise<boolean> {
  return (await browser.evaluate<unknown>(handle, `(document.body.innerText || "").includes(${marker})`).catch(() => false)) === true;
}
