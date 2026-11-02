import type { BrowserPort, SessionHandle } from "../../core/ports/browser.port.js";

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

/**
 * Resilient multi-tier button clicking with DOM fallback.
 * Checks button readiness, clicks via browser port, and falls back to Enter key.
 */
export async function waitForAndClickSendButton(
  browser: BrowserPort,
  handle: SessionHandle,
  sendBtnSelector: string,
  composerSelector: string,
  timeoutMs = 2000,
): Promise<void> {
  let hasSendBtn = false;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    hasSendBtn = await browser.evaluate<boolean>(
      handle,
      `(() => {
        const send = document.querySelector(${JSON.stringify(sendBtnSelector)});
        if (!send) return false;
        const isDisabled = send.disabled || send.getAttribute('aria-disabled') === 'true' || send.classList.contains('ds-button--disabled');
        return !isDisabled;
      })()`,
    ).catch(() => false);

    if (hasSendBtn) break;
    await new Promise((r) => setTimeout(r, 40));
  }

  if (hasSendBtn) {
    // 1. Direct DOM click for instantaneous execution (essential for background tabs)
    await browser.evaluate(
      handle,
      `(() => {
        const send = document.querySelector(${JSON.stringify(sendBtnSelector)});
        if (send && !send.disabled && send.getAttribute('aria-disabled') !== 'true' && !send.classList.contains('ds-button--disabled')) {
          send.click();
          send.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        }
      })()`,
    ).catch(() => {});
    // 2. Coordinate dispatch for active foreground tabs
    await browser.click(handle, sendBtnSelector).catch(() => {});
  }

  // Resilient fallback: If composer still retains text, press Enter key
  await new Promise((r) => setTimeout(r, 100));
  const composerHasText = await browser.evaluate<boolean>(
    handle,
    `(() => {
      const c = document.querySelector(${JSON.stringify(composerSelector)});
      if (!c) return false;
      const val = (c.value || c.innerText || '').trim();
      return val.length > 0;
    })()`,
  ).catch(() => false);

  if (composerHasText) {
    await browser.pressKey(handle, composerSelector, "Enter");
    await browser.evaluate(
      handle,
      `(() => {
        const c = document.querySelector(${JSON.stringify(composerSelector)});
        if (c) {
          c.focus();
          c.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          c.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          c.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        }
      })()`,
    ).catch(() => {});
  }
}
