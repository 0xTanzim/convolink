/**
 * Chromium CDP native input engine.
 * Dispatches protocol-level pointer moves along Bézier curves, modifier-key paste events,
 * and deliberation pauses yielding event.isTrusted: true.
 */

import { generateBezierPath, getDeliberationPause, type Point } from "../common/human-motor.js";

export type CdpSender = (method: string, params: Record<string, unknown>) => Promise<any>;

export interface HumanClickOptions {
  readonly steps?: number;
  readonly dwellMs?: number;
}

export interface PasteOptions {
  readonly deliberationMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function dispatchCdpHumanClick(
  send: CdpSender,
  _targetId: string,
  targetCoords: Point,
  startPoint: Point = { x: 100, y: 100 },
  options: HumanClickOptions = {},
): Promise<void> {
  const path = generateBezierPath(startPoint, targetCoords, { steps: options.steps });

  for (const pt of path) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y });
  }

  const dwell = options.dwellMs ?? 60;
  if (dwell > 0) await sleep(dwell);

  await send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: targetCoords.x,
    y: targetCoords.y,
    button: "left",
    clickCount: 1,
  });

  const clickDwell = Math.max(20, Math.floor(dwell / 2));
  if (clickDwell > 0) await sleep(clickDwell);

  await send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: targetCoords.x,
    y: targetCoords.y,
    button: "left",
    clickCount: 1,
  });
}

export async function dispatchCdpPaste(
  send: CdpSender,
  _targetId: string,
  text: string,
  evaluate: (expr: string) => Promise<unknown>,
  selectorOrOptions?: string | PasteOptions,
  optionsOrUndefined?: PasteOptions,
): Promise<{ ok: boolean; length: number }> {
  const selector = typeof selectorOrOptions === "string" ? selectorOrOptions : undefined;
  const options = (typeof selectorOrOptions === "object" ? selectorOrOptions : optionsOrUndefined) ?? {};

  // 1. Focus target element and try native CDP Input.insertText for background tabs
  if (selector) {
    await evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (el && typeof el.focus === 'function') el.focus();
    })()`).catch(() => {});
  }
  await send("Input.insertText", { text }).catch(() => {});

  // 2. Control+V keydown simulation
  await send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17,
  }).catch(() => {});
  await send("Input.dispatchKeyEvent", {
    type: "rawKeyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86,
  }).catch(() => {});

  // 3. Multi-tier DOM verification and resilient fallback
  const expr = `(() => {
    const el = ${selector ? `document.querySelector(${JSON.stringify(selector)}) || ` : ""}document.activeElement;
    if (!el) return { ok: false, length: 0 };
    if (typeof el.focus === 'function') el.focus();

    const currentLen = ((el.value || el.innerText || el.textContent) || '').trim().length;
    if (currentLen > 0) return { ok: true, length: currentLen };

    const isInput = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
    if (isInput) {
      const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(text)}); else el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, length: el.value?.length ?? 0 };
    }

    try {
      const ev = new InputEvent('beforeinput', { inputType: 'insertText', data: ${JSON.stringify(text)}, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, ${JSON.stringify(text)});
    } catch {}

    let len = ((el.innerText || el.textContent) || '').trim().length;
    if (len === 0 && (el.isContentEditable || el.getAttribute('contenteditable') === 'true')) {
      try {
        const p = document.createElement('p');
        p.textContent = ${JSON.stringify(text)};
        el.innerHTML = '';
        el.appendChild(p);
      } catch {}
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    len = ((el.innerText || el.textContent) || '').trim().length;
    return { ok: Boolean(len > 0), length: len };
  })()`;
  const rawResult = await evaluate(expr);
  const result: { ok: boolean; length: number } =
    rawResult && typeof rawResult === "object" && "ok" in rawResult
      ? (rawResult as { ok: boolean; length: number })
      : { ok: Boolean(rawResult), length: Boolean(rawResult) ? text.length : 0 };

  // 4. KeyUp cleanup
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "v", code: "KeyV", windowsVirtualKeyCode: 86,
  }).catch(() => {});
  await send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17,
  }).catch(() => {});

  const pause = options.deliberationMs ?? getDeliberationPause();
  if (pause > 0) await sleep(pause);
  return result;
}

export async function dispatchCdpKeyPress(send: CdpSender, _targetId: string, key: string): Promise<void> {
  const code = key === "Enter" ? "Enter" : key;
  const windowsVirtualKeyCode = key === "Enter" ? 13 : 0;
  const isEnter = key === "Enter";

  await send("Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key, code, windowsVirtualKeyCode,
    ...(isEnter ? { text: "\r", unmodifiedText: "\r" } : {}),
  });

  if (isEnter) {
    await send("Input.dispatchKeyEvent", {
      type: "char", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13,
    });
  }

  await sleep(35);

  await send("Input.dispatchKeyEvent", {
    type: "keyUp", key, code, windowsVirtualKeyCode,
  });
}
