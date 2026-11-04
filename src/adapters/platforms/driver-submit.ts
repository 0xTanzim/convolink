import type { BrowserPort, SessionHandle } from "../../core/ports/browser.port.js";
import { ConvoError, isConvoError } from "../../core/errors/convo-error.js";
import { buildReadyProbeExpr } from "./page-events.js";
import { isManagedTabRef } from "../browsers/tab-registry.js";
import { probe, remaining, sleep, POLL_MS, waitForMounted } from "./driver-helpers.js";

const DEFAULT_SUBMIT_BUDGET_MS = 30_000;

function debug(message: string): void {
  if (process.env.CONVOLINK_DEBUG === "1") process.stderr.write(`[submit] ${message}\n`);
}

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
      /* convolink:selectors ${JSON.stringify({ composer: selector })} */
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

  if (!(await waitForComposerEmpty(browser, handle, composerSelector, 600))) {
    debug("trusted enter fallback");
    await browser.trustedKey?.(handle, "Enter").catch(() => {});
  }

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
  return (
    (await probe<boolean>(
      browser,
      handle,
      `(() => {
        const body = document.body ? (document.body.innerText || "") : "";
        if (!body.includes(${marker})) return false;
        const composer = document.querySelector('div[contenteditable="true"], textarea, [role="textbox"]');
        const composerText = composer
          ? ((composer.innerText || composer.value || "") as string)
          : "";
        if (composerText.includes(${marker})) {
          return body.replace(composerText, "").includes(${marker});
        }
        return true;
      })()`,
    )) === true
  );
}

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
