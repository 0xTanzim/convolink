import type { PlatformSelectors } from "./platforms.js";

export interface OpResult {
  readonly ok: boolean;
  readonly error?: string;
}

/** Self-contained functions: executeScript serializes them without closures. */

export function fillTextOp(selector: string, text: string): OpResult {
  // executeScript serializes only this body; keep the visible-first pick inline.
  const pick = (): HTMLElement | null => {
    const candidates = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
    for (const candidate of candidates) {
      const rect = candidate.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return candidate;
    }
    return candidates[0] ?? null;
  };
  const el = pick();
  if (!el) return { ok: false, error: `Element not found: ${selector}` };
  el.scrollIntoView({ block: "center", inline: "nearest" });
  if (typeof el.focus === "function") el.focus();

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, text);
    else el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  } else if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
    // Replace, never append: the composer is a rich-text editor, so selection
    // plus insertText is the only path that updates its internal state.
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.execCommand("delete");
    const inserted = document.execCommand("insertText", false, text);
    if (!inserted || (el.innerText || "").trim() !== text.trim()) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
    }
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  } else {
    (el as unknown as { value: string }).value = text;
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }

  const length = (el.innerText || (el as unknown as { value?: string }).value || "").trim().length;
  return length > 0 ? { ok: true } : { ok: false, error: "Composer still has no text" };
}

export function clickOp(selector: string): OpResult {
  const candidates = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
  const el = candidates.find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }) ?? candidates[0] ?? null;
  if (!el) return { ok: false, error: `Element not found: ${selector}` };
  el.scrollIntoView({ block: "center", inline: "nearest" });
  if (typeof el.focus === "function") el.focus();
  el.click();
  return { ok: true };
}

export function focusOp(selector: string): OpResult {
  const candidates = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
  const el = candidates.find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }) ?? candidates[0] ?? null;
  if (!el) return { ok: false, error: `Element not found: ${selector}` };
  if (typeof el.focus === "function") el.focus();
  return { ok: true };
}

export function reloadOp(): OpResult {
  location.reload();
  return { ok: true };
}

export function startNewChatOp(baseUrl: string): OpResult {
  const button = document.querySelector("button[aria-label='New chat'], a[href='/'], a[href='/app']") as HTMLElement | null;
  if (button) {
    button.click();
    return { ok: true };
  }
  if (baseUrl) location.href = baseUrl;
  return { ok: Boolean(baseUrl) };
}

export function pressKeyOp(selector: string, key: string): OpResult {
  const el = (document.querySelector(selector) as HTMLElement | null) || document.activeElement || document.body;
  const keyCode = key === "Enter" ? 13 : 0;
  const init = { key, code: key, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true };
  el.dispatchEvent(new KeyboardEvent("keydown", init));
  el.dispatchEvent(new KeyboardEvent("keypress", init));
  el.dispatchEvent(new KeyboardEvent("keyup", init));
  return { ok: true };
}

export function probeSelectorsOp(selectors: PlatformSelectors) {
  const composer = document.querySelector(selectors.composer);
  return {
    ok: Boolean(composer),
    layoutVariant: "companion-v2",
    composerSelector: selectors.composer,
    sendButtonSelector: selectors.send,
    stopIndicatorSelector: selectors.stop,
    turnContainerSelector: selectors.turns,
  };
}

export function probeMountedOp(composerSelector: string): boolean {
  return document.readyState === "complete" && Boolean(document.querySelector(composerSelector));
}

export function probeReadyOp(composerSelector: string, sendSelector: string): boolean {
  if (document.readyState !== "complete") return false;
  if (!document.querySelector(composerSelector)) return false;
  const send = document.querySelector(sendSelector) as HTMLElement | null;
  if (!send) return false;
  return !(send as HTMLButtonElement).disabled && send.getAttribute("aria-disabled") !== "true";
}

export function probeQuietOp() {
  return {
    readyState: document.readyState,
    nodes: document.querySelectorAll("*").length,
    text: document.body?.innerText?.length ?? 0,
  };
}

export function probeComposerTextOp(selector: string): boolean {
  const candidates = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
  const el = candidates.find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }) ?? candidates[0] ?? null;
  if (!el) return false;
  return ((el.innerText || (el as unknown as { value?: string }).value || "") as string).trim().length > 0;
}

export function getUrlOp(): string {
  return location.href;
}

export function getTextOp(selector: string): string {
  const candidates = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
  const el = candidates.find((candidate) => {
    const rect = candidate.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }) ?? candidates[0] ?? null;
  return el ? (el.innerText || el.textContent || "").trim() : "";
}

export function getLastTextOp(selector: string): string {
  const nodes = Array.from(document.querySelectorAll(selector)) as HTMLElement[];
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (!node) continue;
    const rect = node.getBoundingClientRect();
    const text = (node.innerText || node.textContent || "").trim();
    if (text && (rect.width > 0 || rect.height > 0)) return text;
  }
  return "";
}

export function bodyIncludesOp(marker: string): boolean {
  return (document.body?.innerText || "").includes(marker);
}


export function readThreadOp(selectors: PlatformSelectors, lastN: number) {
  // executeScript serializes this function alone; every helper must be inline.
  // A thrown error would arrive as a null result, hiding the cause, so the
  // whole body reports its own failure.
  try {
  const codeBlocksOf = (root: Element): Array<{ language: string; code: string }> =>
    Array.from(root.querySelectorAll("pre")).map((pre) => {
      const codeEl = pre.querySelector("code");
      const code = (codeEl?.textContent ?? pre.textContent ?? "").replace(/\n$/, "");
      const language = /language-([a-zA-Z0-9_-]+)/.exec(codeEl?.className || "")?.[1] || "text";
      return { language, code };
    });
  // When a role attribute exists, the marker's parent is the message node.
  const roleAttr = selectors.turnRoleAttr;
  const nodes = roleAttr
    ? Array.from(document.querySelectorAll("[" + roleAttr + "]")).slice(-Math.max(1, lastN)).map((m) => m.parentElement).filter((n): n is HTMLElement => Boolean(n))
    : Array.from(document.querySelectorAll(selectors.turns)).slice(-Math.max(1, lastN));
  const roleOf = (node: Element, marker?: Element | null): "user" | "assistant" => {
    if (roleAttr) {
      const attr = (marker ?? node.querySelector("[" + roleAttr + "]"))?.getAttribute(roleAttr);
      if (attr) return attr === "user" ? "user" : "assistant";
    }
    if (node.matches(selectors.user) || node.querySelector(selectors.user)) return "user";
    return "assistant";
  };
  const stripLabel = (text: string): string => text.replace(/^(You said:|ChatGPT said:|You:|Assistant:)\s*/i, "");
  const turns = nodes.map((node, index) => {
    const role = roleOf(node);
    const text = stripLabel(((node as HTMLElement).innerText || "").trim());
    return {
      turnIndex: index,
      role,
      markdownContent: text,
      codeBlocks: role === "user" ? [] : codeBlocksOf(node),
      contentHash: String(text.length),
    };
  });
  return { layoutVariant: "companion-v2", turns };
  } catch (error) {
    return { layoutVariant: "companion-v2", turns: [], probeError: String((error as Error)?.message ?? error) };
  }
}

export function statusOp(selectors: PlatformSelectors, beforeTurnCount: number) {
  // executeScript serializes this function alone; every helper must be inline.
  try {
  const visibleInPage = (el: Element | null): boolean => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = getComputedStyle(el);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
  };
  const codeBlocksOf = (root: Element): Array<{ language: string; code: string }> =>
    Array.from(root.querySelectorAll("pre")).map((pre) => {
      const codeEl = pre.querySelector("code");
      const code = (codeEl?.textContent ?? pre.textContent ?? "").replace(/\n$/, "");
      const language = /language-([a-zA-Z0-9_-]+)/.exec(codeEl?.className || "")?.[1] || "text";
      return { language, code };
    });
  const roleAttr = selectors.turnRoleAttr;
  const nodes = roleAttr
    ? Array.from(document.querySelectorAll("[" + roleAttr + "]")).map((m) => m.parentElement).filter((n): n is HTMLElement => Boolean(n))
    : Array.from(document.querySelectorAll(selectors.turns));
  const roleOf = (node: Element): "user" | "assistant" | null => {
    if (roleAttr) {
      const attr = node.querySelector("[" + roleAttr + "]")?.getAttribute(roleAttr);
      if (attr) return attr === "user" ? "user" : "assistant";
    }
    if (node.matches(selectors.user) || node.querySelector(selectors.user)) return "user";
    if (node.matches(selectors.assistant) || node.querySelector(selectors.assistant)) return "assistant";
    return null;
  };
  const stripLabel = (text: string): string => text.replace(/^(You said:|ChatGPT said:|You:|Assistant:)\s*/i, "");
  const last = nodes[nodes.length - 1] as HTMLElement | undefined;
  const lastRole = last ? roleOf(last) : null;
  const assistantNode = roleAttr
    ? (([...nodes].reverse().find((n) => roleOf(n) === "assistant") as unknown) as HTMLElement | undefined) ?? null
    : last
      ? ((last.querySelector(selectors.assistant) ?? last) as HTMLElement)
      : null;
  const answerTextOf = (node: HTMLElement): string => {
    // Icon fonts and screen-reader labels are part of innerText; neither is
    // part of the answer. Prefer the markdown body when the platform has one.
    const body = node.querySelector(".standard-markdown, .ds-markdown, .markdown, [class*='markdown']") as HTMLElement | null;
    const source = body ?? node;
    const clone = source.cloneNode(true) as HTMLElement;
    clone.querySelectorAll(".sr-only").forEach((el) => el.remove());
    const text = (clone.innerText || "")
      .replace(/[\uE000-\uF8FF]/g, "")
      .replace(/\bjust now\b\s*$/i, "")
      .trim();
    return stripLabel(text);
  };
  const assistantText = assistantNode ? answerTextOf(assistantNode) : "";
  return {
    turnsCount: nodes.length,
    turnIndex: Math.max(0, nodes.length - 1),
    // A trailing user message means the assistant turn has not arrived yet.
    hasNewTurn: nodes.length > beforeTurnCount && (lastRole ? lastRole === "assistant" : !roleAttr),
    // ChatGPT keeps the stop control in the DOM after a response; only a
    // visible stop control means generation is still running.
    isGenerating: visibleInPage(document.querySelector(selectors.stop)),
    // A reasoning panel stays mounted after it finishes; only an animated
    // indicator inside it means the model is still thinking.
    isThinking: Boolean(
      visibleInPage(document.querySelector(selectors.thinking)) &&
        document.querySelector(selectors.thinking)?.querySelector(
          '[class*="spin"], [class*="animate"], [class*="loading"], [class*="pulse"], [class*="blink"], [role="progressbar"], svg[class*="spin"]',
        ),
    ),
    assistantText,
    text: assistantText,
    codeBlocks: assistantNode ? codeBlocksOf(assistantNode) : [],
  };
  } catch (error) {
    return { turnsCount: 0, hasNewTurn: false, isGenerating: false, isThinking: false, assistantText: "", text: "", codeBlocks: [], probeError: String((error as Error)?.message ?? error) };
  }
}
