import type { PlatformSelectors } from "./platforms.js";

export interface OpResult {
  readonly ok: boolean;
  readonly error?: string;
}

/** Self-contained functions: executeScript serializes them without closures. */
export function fillTextOp(selector: string, text: string): OpResult {
  const el = document.querySelector(selector) as HTMLElement | null;
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
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const inserted = document.execCommand("insertText", false, text);
    if (!inserted || !(el.innerText || "").trim()) el.textContent = text;
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  } else {
    (el as unknown as { value: string }).value = text;
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }

  const length = (el.innerText || (el as unknown as { value?: string }).value || "").trim().length;
  return length > 0 ? { ok: true } : { ok: false, error: "Composer still has no text" };
}

export function clickOp(selector: string): OpResult {
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return { ok: false, error: `Element not found: ${selector}` };
  el.scrollIntoView({ block: "center", inline: "nearest" });
  if (typeof el.focus === "function") el.focus();
  el.click();
  return { ok: true };
}

export function focusOp(selector: string): OpResult {
  const el = document.querySelector(selector) as HTMLElement | null;
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
  const el = document.querySelector(selector) as HTMLElement | null;
  if (!el) return false;
  return ((el.innerText || (el as unknown as { value?: string }).value || "") as string).trim().length > 0;
}

export function getUrlOp(): string {
  return location.href;
}

export function getTextOp(selector: string): string {
  const el = document.querySelector(selector) as HTMLElement | null;
  return el ? (el.innerText || el.textContent || "").trim() : "";
}

export function bodyIncludesOp(marker: string): boolean {
  return (document.body?.innerText || "").includes(marker);
}

function codeBlocksOf(text: string): Array<{ language: string; code: string }> {
  const blocks: Array<{ language: string; code: string }> = [];
  const pattern = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    blocks.push({ language: match[1] || "text", code: match[2] || "" });
  }
  return blocks;
}

export function readThreadOp(selectors: PlatformSelectors, lastN: number) {
  const nodes = Array.from(document.querySelectorAll(selectors.turns)).slice(-Math.max(1, lastN));
  const turns = nodes.map((node, index) => {
    const isUser = Boolean(node.querySelector(selectors.user)) || node.matches(selectors.user);
    const textNode = isUser ? (node.querySelector(selectors.user) ?? node) : (node.querySelector(selectors.assistant) ?? node);
    const text = ((textNode as HTMLElement).innerText || "").trim();
    return {
      turnIndex: index,
      role: isUser ? "user" : "assistant",
      markdownContent: text,
      codeBlocks: isUser ? [] : codeBlocksOf(text),
      contentHash: String(text.length),
    };
  });
  return { layoutVariant: "companion-v2", turns };
}

export function statusOp(selectors: PlatformSelectors, beforeTurnCount: number) {
  const nodes = Array.from(document.querySelectorAll(selectors.turns));
  const last = nodes[nodes.length - 1] as HTMLElement | undefined;
  const assistantNode = last ? ((last.querySelector(selectors.assistant) ?? last) as HTMLElement) : null;
  const assistantText = assistantNode ? (assistantNode.innerText || "").trim() : "";
  return {
    turnsCount: nodes.length,
    turnIndex: Math.max(0, nodes.length - 1),
    hasNewTurn: nodes.length > beforeTurnCount,
    isGenerating: Boolean(document.querySelector(selectors.stop)),
    isThinking: Boolean(document.querySelector(selectors.thinking)),
    assistantText,
    text: assistantText,
    codeBlocks: assistantText ? codeBlocksOf(assistantText) : [],
  };
}
