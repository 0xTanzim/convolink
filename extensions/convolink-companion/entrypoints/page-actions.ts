/**
 * Generic browser-control operations.
 *
 * Every function here is injected by `chrome.scripting.executeScript`, which
 * serializes only the function body: no closures, no module helpers. Each one
 * also catches its own errors, because a throw crosses the boundary as a bare
 * `null` result and hides the cause from the host.
 */

export interface ActionResult {
  readonly ok: boolean;
  readonly error?: string;
  readonly [key: string]: unknown;
}

export function scrollOp(mode: string, amount: number): ActionResult {
  try {
    if (mode === "top") window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
    else if (mode === "bottom") window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" as ScrollBehavior });
    else window.scrollBy({ top: amount, behavior: "instant" as ScrollBehavior });
    return { ok: true, scrollY: Math.round(window.scrollY), height: document.body.scrollHeight };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

export function scrollToElementOp(selector: string): ActionResult {
  try {
    const el = document.querySelector(selector);
    if (!el) return { ok: false, error: `Element not found: ${selector}` };
    el.scrollIntoView({ block: "center", inline: "nearest" });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

/**
 * Browser-level text injection inserts at the caret, so the editor has to own
 * the selection first. Ends the caret after the last character to append.
 */
export function focusEndOp(selector: string): ActionResult {
  try {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return { ok: false, error: `Element not found: ${selector}` };
    el.scrollIntoView({ block: "center", inline: "nearest" });
    if (typeof el.focus === "function") el.focus();

    if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const end = el.value.length;
      el.setSelectionRange(end, end);
    }

    return { ok: document.activeElement === el };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

export function hoverOp(selector: string): ActionResult {
  try {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return { ok: false, error: `Element not found: ${selector}` };
    el.scrollIntoView({ block: "center", inline: "nearest" });
    const rect = el.getBoundingClientRect();
    const init = {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    };
    el.dispatchEvent(new PointerEvent("pointerover", init));
    el.dispatchEvent(new MouseEvent("mouseover", init));
    el.dispatchEvent(new PointerEvent("pointerenter", init));
    el.dispatchEvent(new MouseEvent("mouseenter", init));
    el.dispatchEvent(new MouseEvent("mousemove", init));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

export function typeTextOp(selector: string, text: string, submit: boolean): ActionResult {
  try {
    const el = document.querySelector(selector) as HTMLElement | null;
    if (!el) return { ok: false, error: `Element not found: ${selector}` };
    el.scrollIntoView({ block: "center", inline: "nearest" });
    if (typeof el.focus === "function") el.focus();

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      if (setter) setter.call(el, text);
      else el.value = text;
    } else if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      document.execCommand("delete");
      const inserted = document.execCommand("insertText", false, text);
      if (!inserted || (el.innerText || "").trim() !== text.trim()) el.textContent = text;
    } else {
      el.textContent = text;
    }

    el.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, inputType: "insertText", data: text }));
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));

    if (submit) {
      const keyInit = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
      el.dispatchEvent(new KeyboardEvent("keydown", keyInit));
      el.dispatchEvent(new KeyboardEvent("keypress", keyInit));
      el.dispatchEvent(new KeyboardEvent("keyup", keyInit));
    }

    const value = (el.innerText || (el as unknown as { value?: string }).value || "").trim();
    return { ok: value.length > 0, valueLength: value.length };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

/**
 * Platform toggles (DeepThink, Search) are plain buttons whose selected state
 * lives in a class. Clicking only when the state differs keeps repeat asks
 * idempotent instead of flipping the toggle back off.
 */
export function applyTogglesOp(
  selector: string,
  selectedClass: string,
  toggles: Record<string, { label: string; selected: boolean }>,
): ActionResult {
  try {
    const buttons = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
    if (buttons.length === 0) return { ok: false, error: `No toggle buttons matched: ${selector}` };
    const applied: string[] = [];
    const missing: string[] = [];

    for (const [key, wanted] of Object.entries(toggles)) {
      const button = buttons.find((candidate) => (candidate.innerText || "").trim().includes(wanted.label));
      if (!button) {
        missing.push(key);
        continue;
      }
      const isSelected = (button.className || "").includes(selectedClass);
      if (isSelected === wanted.selected) continue;
      button.click();
      applied.push(key);
    }

    return { ok: missing.length === 0, applied, missing };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

export async function waitForSelectorOp(selector: string, timeoutMs: number): Promise<ActionResult> {
  try {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    while (Date.now() < deadline) {
      if (document.querySelector(selector)) return { ok: true, found: true };
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { ok: false, found: false, error: `Selector not found within ${timeoutMs}ms: ${selector}` };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

export function getHtmlOp(selector: string): ActionResult {
  try {
    const el = selector ? document.querySelector(selector) : document.documentElement;
    if (!el) return { ok: false, error: `Element not found: ${selector}` };
    return { ok: true, html: el.outerHTML.slice(0, 200_000) };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

export function selectOptionOp(selector: string, value: string): ActionResult {
  try {
    const el = document.querySelector(selector) as HTMLSelectElement | null;
    if (!el) return { ok: false, error: `Element not found: ${selector}` };
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    return { ok: true, value: el.value };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

export function diagnoseOp(selectors: { composer: string; send: string; turns: string; stop: string; thinking: string }): ActionResult {
  try {
    const visible = (el: Element | null): boolean => {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
    };
    const composer = document.querySelector(selectors.composer) as HTMLElement | null;
    const send = document.querySelector(selectors.send) as HTMLButtonElement | null;
    const turns = document.querySelectorAll(selectors.turns);
    const composerText = composer ? ((composer.innerText || (composer as unknown as { value?: string }).value || "") as string).trim() : "";
    return {
      ok: true,
      url: location.href,
      readyState: document.readyState,
      composerFound: Boolean(composer),
      composerVisible: visible(composer),
      composerTextLength: composerText.length,
      composerIsActive: Boolean(composer && document.activeElement === composer),
      sendFound: Boolean(send),
      sendDisabled: send ? Boolean(send.disabled) : null,
      sendAriaDisabled: send ? send.getAttribute("aria-disabled") : null,
      sendVisible: visible(send),
      turns: turns.length,
      stopVisible: visible(document.querySelector(selectors.stop)),
      thinkingVisible: visible(document.querySelector(selectors.thinking)),
      bodyLength: (document.body?.innerText || "").length,
      visibilityState: document.visibilityState,
      documentHidden: Boolean(document.hidden),
      hasFocus: typeof document.hasFocus === "function" ? document.hasFocus() : null,
    };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}
