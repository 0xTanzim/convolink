/**
 * Gecko WebDriver BiDi native input engine.
 * Dispatches input.performActions pointer movement along Bézier curves,
 * native key sequences, and clipboard paste actions yielding event.isTrusted: true.
 */

import { generateBezierPath, getDeliberationPause, type Point } from "../common/human-motor.js";

export type BidiSender = (method: string, params: Record<string, unknown>) => Promise<any>;

export interface BidiClickOptions {
  readonly steps?: number;
  readonly dwellMs?: number;
}

export interface BidiPasteOptions {
  readonly deliberationMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function dispatchBidiHumanClick(
  send: BidiSender,
  context: string,
  targetCoords: Point,
  startPoint: Point = { x: 100, y: 100 },
  options: BidiClickOptions = {},
): Promise<void> {
  const path = generateBezierPath(startPoint, targetCoords, { steps: options.steps });
  const hoverDwell = options.dwellMs ?? 50;
  const clickDwell = Math.max(20, Math.floor(hoverDwell / 2));

  const subActions: Array<Record<string, unknown>> = [];
  for (const pt of path) {
    subActions.push({ type: "pointerMove", x: pt.x, y: pt.y, duration: 15 });
  }

  if (hoverDwell > 0) subActions.push({ type: "pause", duration: hoverDwell });
  subActions.push({ type: "pointerDown", button: 0 });
  if (clickDwell > 0) subActions.push({ type: "pause", duration: clickDwell });
  subActions.push({ type: "pointerUp", button: 0 });

  await send("input.performActions", {
    context,
    actions: [
      {
        type: "pointer",
        id: "mouse",
        parameters: { pointerType: "mouse" },
        actions: subActions,
      },
    ],
  });
}

export async function dispatchBidiKeyPress(send: BidiSender, context: string, key: string): Promise<void> {
  const keyVal = key === "Enter" ? "\uE007" : key;
  await send("input.performActions", {
    context,
    actions: [
      {
        type: "key",
        id: "keyboard",
        actions: [
          { type: "keyDown", value: keyVal },
          { type: "pause", duration: 35 },
          { type: "keyUp", value: keyVal },
        ],
      },
    ],
  });
}

export async function dispatchBidiPaste(
  send: BidiSender,
  context: string,
  text: string,
  evaluate: (expr: string) => Promise<unknown>,
  selectorOrOptions?: string | BidiPasteOptions,
  optionsOrUndefined?: BidiPasteOptions,
): Promise<{ ok: boolean; length: number }> {
  const selector = typeof selectorOrOptions === "string" ? selectorOrOptions : undefined;
  const options = (typeof selectorOrOptions === "object" ? selectorOrOptions : optionsOrUndefined) ?? {};

  // Modifier Control keydown
  await send("input.performActions", {
    context,
    actions: [
      {
        type: "key",
        id: "keyboard",
        actions: [
          { type: "keyDown", value: "\uE009" }, // Control key in WebDriver BiDi
          { type: "keyDown", value: "v" },
        ],
      },
    ],
  });

  // Inject text in DOM context with 3-tier resilient injection
  const expr = `(() => {
    const el = ${selector ? `document.querySelector(${JSON.stringify(selector)}) || ` : ""}document.activeElement;
    if (!el) return { ok: false, length: 0 };
    if (typeof el.focus === 'function') el.focus();

    const isInputOrTextArea = el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement;
    if (isInputOrTextArea) {
      const proto = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (setter) setter.call(el, ${JSON.stringify(text)});
      else el.value = ${JSON.stringify(text)};
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return { ok: true, length: el.value?.length ?? 0 };
    }

    document.execCommand('selectAll', false, null);
    const success = document.execCommand('insertText', false, ${JSON.stringify(text)});
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    const len = ((el.innerText || el.textContent) || '').trim().length;
    return { ok: Boolean(success || len > 0), length: len };
  })()`;
  const rawResult = await evaluate(expr);
  const result: { ok: boolean; length: number } =
    rawResult && typeof rawResult === "object" && "ok" in rawResult
      ? (rawResult as { ok: boolean; length: number })
      : { ok: Boolean(rawResult), length: Boolean(rawResult) ? text.length : 0 };

  // Release keys
  await send("input.performActions", {
    context,
    actions: [
      {
        type: "key",
        id: "keyboard",
        actions: [
          { type: "keyUp", value: "v" },
          { type: "keyUp", value: "\uE009" },
        ],
      },
    ],
  });

  // Deliberation pause before send
  const pause = options.deliberationMs ?? getDeliberationPause();
  if (pause > 0) await sleep(pause);

  return result;
}
