import { PLATFORM_SELECTORS, type PlatformKey } from "./platforms.js";
import type { ExtensionApi, JsonRecord, OwnershipPort } from "./extension-api.js";
import { handleTabCommand, isTabCommand } from "./tab-commands.js";
import {
  bodyIncludesOp,
  clickOp,
  fillTextOp,
  focusOp,
  getLastTextOp,
  getTextOp,
  getUrlOp,
  pressKeyOp,
  probeComposerTextOp,
  probeMountedOp,
  probeQuietOp,
  probeReadyOp,
  probeSelectorsOp,
  readThreadOp,
  reloadOp,
  startNewChatOp,
  statusOp,
} from "./operations.js";
import {
  diagnoseOp,
  getHtmlOp,
  hoverOp,
  scrollOp,
  scrollToElementOp,
  selectOptionOp,
  typeTextOp,
  waitForSelectorOp,
} from "./page-actions.js";
import { sendTrustedKey, sendTrustedText } from "./trusted-input.js";

export interface RouterContext {
  readonly api: ExtensionApi;
  readonly ownership: OwnershipPort;
  readonly loadOwnedTabs: () => Promise<void>;
  readonly saveOwnedTabs: () => Promise<void>;
  readonly runInTab: <T>(tabId: number, func: (...args: never[]) => T, args: unknown[]) => Promise<T>;
  readonly sendResult: (id: number, result: unknown) => void;
  readonly sendError: (id: number, code: string, message: string, retryable?: boolean) => void;
  buildId: string;
}

export async function handleCommand(message: JsonRecord & { id: number; type: string }, ctx: RouterContext): Promise<void> {
  const { id, type } = message;
  const { api, ownership } = ctx;
  const targetId = Number(message.targetId);
  const platform = typeof message.platform === "string" ? (message.platform as PlatformKey) : null;
  const selectors = platform ? PLATFORM_SELECTORS[platform] : null;

  const objectResult = <T>(label: string, value: T | null | undefined): T => {
    if (value === null || value === undefined) {
      throw new Error(`${label} returned no value (the injected page function threw or did not return).`);
    }
    return value;
  };

  try {
    if (isTabCommand(type)) {
      await handleTabCommand(message, ctx);
      return;
    }
    switch (type) {
      case "PING":
        ctx.sendResult(id, { pong: true, version: api.runtime.getManifest().version, protocol: 2, buildId: ctx.buildId });
        return;

      case "GET_URL":
        ctx.sendResult(id, await ctx.runInTab(targetId, getUrlOp, []));
        return;

      case "GET_LAST_TEXT":
        ctx.sendResult(id, await ctx.runInTab(targetId, getLastTextOp, [String(message.selector ?? "")]));
        return;

      case "GET_TEXT":
        ctx.sendResult(id, await ctx.runInTab(targetId, getTextOp, [String(message.selector ?? "")]));
        return;

      case "GET_HTML": {
        const result = objectResult("GET_HTML", await ctx.runInTab(targetId, getHtmlOp, [String(message.selector ?? "")]));
        if (result.ok === false) throw new Error(String(result.error));
        ctx.sendResult(id, result);
        return;
      }

      case "GET_BODY_INCLUDES":
        ctx.sendResult(id, await ctx.runInTab(targetId, bodyIncludesOp, [String(message.text)]));
        return;

      case "PROBE_SELECTORS":
        if (!selectors) throw new Error(`Unknown platform: ${String(platform)}`);
        ctx.sendResult(id, await ctx.runInTab(targetId, probeSelectorsOp, [selectors]));
        return;

      case "PROBE_MOUNTED":
        ctx.sendResult(id, await ctx.runInTab(targetId, probeMountedOp, [String(message.composer)]));
        return;

      case "PROBE_READY":
        ctx.sendResult(id, await ctx.runInTab(targetId, probeReadyOp, [String(message.composer), String(message.send)]));
        return;

      case "PROBE_QUIET":
        ctx.sendResult(id, await ctx.runInTab(targetId, probeQuietOp, []));
        return;

      case "PROBE_COMPOSER_TEXT":
        ctx.sendResult(id, await ctx.runInTab(targetId, probeComposerTextOp, [String(message.selector)]));
        return;

      case "DIAGNOSE": {
        if (!selectors) throw new Error(`Unknown platform: ${String(platform)}`);
        const result = objectResult("DIAGNOSE", await ctx.runInTab(targetId, diagnoseOp, [selectors]));
        ctx.sendResult(id, { ...result, buildId: ctx.buildId });
        return;
      }

      case "READ_THREAD": {
        if (!selectors) throw new Error(`Unknown platform: ${String(platform)}`);
        ctx.sendResult(id, objectResult("READ_THREAD", await ctx.runInTab(targetId, readThreadOp, [selectors, Number(message.lastN) || 20])));
        return;
      }

      case "PROBE_STATUS": {
        if (!selectors) throw new Error(`Unknown platform: ${String(platform)}`);
        const status = objectResult(
          "PROBE_STATUS",
          await ctx.runInTab(targetId, statusOp, [selectors, Number(message.beforeTurnCount) || 0]),
        ) as JsonRecord;
        if (status.probeError) throw new Error(`Status probe failed in page: ${String(status.probeError)}`);
        ctx.sendResult(id, status);
        return;
      }

      case "FOCUS":
        ctx.sendResult(id, await ctx.runInTab(targetId, focusOp, [String(message.selector)]));
        return;

      case "CLICK":
        ctx.sendResult(id, await ctx.runInTab(targetId, clickOp, [String(message.selector)]));
        return;

      case "HOVER": {
        const result = objectResult("HOVER", await ctx.runInTab(targetId, hoverOp, [String(message.selector)]));
        if (result.ok === false) throw new Error(String(result.error));
        ctx.sendResult(id, result);
        return;
      }

      case "SCROLL": {
        const result = objectResult(
          "SCROLL",
          await ctx.runInTab(targetId, scrollOp, [String(message.mode ?? "by"), Number(message.amount) || 0]),
        );
        ctx.sendResult(id, result);
        return;
      }

      case "SCROLL_TO": {
        const result = objectResult("SCROLL_TO", await ctx.runInTab(targetId, scrollToElementOp, [String(message.selector)]));
        if (result.ok === false) throw new Error(String(result.error));
        ctx.sendResult(id, result);
        return;
      }

      case "WAIT_FOR_SELECTOR": {
        const timeout = Math.min(Number(message.timeoutMs) || 8_000, 10_000);
        const result = objectResult(
          "WAIT_FOR_SELECTOR",
          await ctx.runInTab(targetId, waitForSelectorOp, [String(message.selector), timeout]),
        );
        if (result.ok === false) throw new Error(String(result.error));
        ctx.sendResult(id, result);
        return;
      }

      case "SELECT_OPTION": {
        const result = objectResult(
          "SELECT_OPTION",
          await ctx.runInTab(targetId, selectOptionOp, [String(message.selector), String(message.value)]),
        );
        if (result.ok === false) throw new Error(String(result.error));
        ctx.sendResult(id, result);
        return;
      }

      case "RELOAD":
        await ctx.runInTab(targetId, reloadOp, []);
        ctx.sendResult(id, { ok: true });
        return;

      case "PROBE_CONTINUATION":
        ctx.sendResult(id, { hasContinuation: false, triggerSelector: null });
        return;

      case "PROBE_DOWNLOADS":
        ctx.sendResult(id, []);
        return;

      case "INSPECT_CANVAS":
        ctx.sendResult(id, null);
        return;

      case "START_NEW_CHAT": {
        const result = objectResult("START_NEW_CHAT", await ctx.runInTab(targetId, startNewChatOp, [String(message.baseUrl || "")]));
        ctx.sendResult(id, result);
        return;
      }

      case "FILL_TEXT": {
        const result = objectResult(
          "FILL_TEXT",
          await ctx.runInTab(targetId, fillTextOp, [String(message.selector), String(message.text)]),
        );
        if (!result?.ok) ctx.sendError(id, "not-ready", result?.error || "Composer did not accept the text", true);
        else ctx.sendResult(id, result);
        return;
      }

      case "TYPE_TEXT": {
        const result = objectResult(
          "TYPE_TEXT",
          await ctx.runInTab(targetId, typeTextOp, [String(message.selector), String(message.text), Boolean(message.submit)]),
        );
        if (result.ok === false) throw new Error(String(result.error));
        ctx.sendResult(id, result);
        return;
      }

      case "PRESS_KEY":
        ctx.sendResult(id, await ctx.runInTab(targetId, pressKeyOp, [String(message.selector), String(message.key)]));
        return;

      case "TRUSTED_FILL": {
        // Rich-text editors ignore DOM-only text injection for submit gating:
        // the visible text changes but the editor state stays empty. Clear via
        // the DOM, then type through the browser input pipeline.
        const selector = String(message.selector);
        const text = String(message.text ?? "");
        await ctx.runInTab(targetId, fillTextOp, [selector, ""]);
        await sendTrustedText(api, targetId, text);
        const filled = await ctx.runInTab(targetId, probeComposerTextOp, [selector]);
        ctx.sendResult(id, { ok: Boolean(filled), trusted: true });
        return;
      }

      case "TRUSTED_KEY":
        await sendTrustedKey(api, targetId, String(message.key || "Enter"));
        ctx.sendResult(id, { ok: true, trusted: true, key: String(message.key || "Enter") });
        return;

      case "TRUSTED_TYPE":
        await sendTrustedText(api, targetId, String(message.text ?? ""));
        ctx.sendResult(id, { ok: true, trusted: true });
        return;

      default:
        ctx.sendError(id, "unsupported", `Unknown command: ${type}`, false);
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const code = text.includes("not found")
      ? "tab-not-found"
      : text.includes("timed out")
        ? "timeout"
        : text.includes("debugger")
          ? "unsupported"
          : "internal";
    ctx.sendError(id, code, text, code === "timeout");
  }
}
