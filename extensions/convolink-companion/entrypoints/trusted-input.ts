import type { ExtensionApi, JsonRecord } from "./extension-api.js";

const DEBUGGER_PROTOCOL = "1.3";

function requireDebugger(api: ExtensionApi) {
  if (!api.debugger) {
    throw new Error("The debugger permission is unavailable; reload the extension and accept the prompt.");
  }
  return api.debugger;
}

/**
 * Trusted (browser-level) key input. Synthetic KeyboardEvents are ignored by
 * some editors because `isTrusted` is false, so this path drives DevTools
 * input injection instead. The debugger is attached only for the keystroke.
 */
export async function sendTrustedKey(api: ExtensionApi, tabId: number, key: string): Promise<void> {
  const debuggerApi = requireDebugger(api);
  const target = { tabId };
  await debuggerApi.attach(target, DEBUGGER_PROTOCOL);
  try {
    const isEnter = key === "Enter";
    const base: JsonRecord = {
      key,
      code: isEnter ? "Enter" : key,
      windowsVirtualKeyCode: isEnter ? 13 : 0,
      nativeVirtualKeyCode: isEnter ? 13 : 0,
      ...(isEnter ? { text: "\r", unmodifiedText: "\r" } : {}),
    };
    await debuggerApi.sendCommand(target, "Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      ...(isEnter ? { text: "\r", unmodifiedText: "\r" } : {}),
      ...base,
    });
    await debuggerApi.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", ...base });
  } finally {
    await debuggerApi.detach(target).catch(() => undefined);
  }
}

export async function sendTrustedText(api: ExtensionApi, tabId: number, text: string): Promise<void> {
  const debuggerApi = requireDebugger(api);
  const target = { tabId };
  await debuggerApi.attach(target, DEBUGGER_PROTOCOL);
  try {
    await debuggerApi.sendCommand(target, "Input.insertText", { text });
  } finally {
    await debuggerApi.detach(target).catch(() => undefined);
  }
}
