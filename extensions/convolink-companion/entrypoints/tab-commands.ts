import { platformForUrl } from "./platforms.js";
import type { ExtensionApi, JsonRecord, OwnershipPort } from "./extension-api.js";

export interface TabCommandContext {
  readonly api: ExtensionApi;
  readonly ownership: OwnershipPort;
  readonly loadOwnedTabs: () => Promise<void>;
  readonly saveOwnedTabs: () => Promise<void>;
  readonly sendResult: (id: number, result: unknown) => void;
  readonly sendError: (id: number, code: string, message: string, retryable?: boolean) => void;
}

const TAB_COMMANDS = new Set([
  "LIST_TABS",
  "TAB_INFO",
  "ACTIVATE_TAB",
  "BRING_TO_FRONT",
  "CREATE_TAB",
  "CLOSE_TAB",
  "DUPLICATE_TAB",
  "SCREENSHOT",
  "NAVIGATE",
]);

export function isTabCommand(type: string): boolean {
  return TAB_COMMANDS.has(type);
}

async function focusTab(api: ExtensionApi, tabId: number): Promise<number | undefined> {
  const tab = await api.tabs.update(tabId, { active: true });
  if (tab.windowId !== undefined) await api.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  return tab.windowId;
}

export async function handleTabCommand(
  message: JsonRecord & { id: number; type: string },
  ctx: TabCommandContext,
): Promise<void> {
  const { id, type } = message;
  const { api, ownership } = ctx;
  const targetId = Number(message.targetId);

  switch (type) {
    case "LIST_TABS": {
      const tabs = await api.tabs.query({});
      await ctx.loadOwnedTabs();
      ctx.sendResult(
        id,
        tabs
          .filter((tab) => tab.id !== undefined && Boolean(platformForUrl(tab.url || "")))
          .map((tab) => ({
            tabId: tab.id,
            title: tab.title || "Untitled AI Tab",
            url: tab.url,
            windowId: tab.windowId,
            active: Boolean(tab.active),
            owned: ownership.has(Number(tab.id)),
            platform: platformForUrl(tab.url || ""),
          })),
      );
      return;
    }
    case "TAB_INFO": {
      const tab = await api.tabs.get(targetId);
      ctx.sendResult(id, {
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        windowId: tab.windowId,
        active: Boolean(tab.active),
        owned: ownership.has(targetId),
        platform: platformForUrl(tab.url || ""),
      });
      return;
    }
    case "ACTIVATE_TAB":
    case "BRING_TO_FRONT": {
      const windowId = await focusTab(api, targetId);
      ctx.sendResult(id, { active: true, windowId });
      return;
    }
    case "CREATE_TAB": {
      const url = String(message.url);
      const tab = await api.tabs.create({ url, active: message.active === true });
      if (tab.id !== undefined) {
        ownership.add(tab.id);
        await ctx.saveOwnedTabs();
      }
      ctx.sendResult(id, { tabId: tab.id, title: tab.title || "", url: tab.url || url, owned: true });
      return;
    }
    case "CLOSE_TAB": {
      await ctx.loadOwnedTabs();
      if (!ownership.canClose(targetId, message.force === true)) {
        ctx.sendError(id, "not-owned", `Tab ${targetId} was not opened by ConvoLink`, false);
        return;
      }
      await api.tabs.remove(targetId);
      ownership.remove(targetId);
      await ctx.saveOwnedTabs();
      ctx.sendResult(id, { closed: true });
      return;
    }
    case "DUPLICATE_TAB": {
      const tab = await api.tabs.duplicate(targetId);
      if (tab.id !== undefined) {
        ownership.add(tab.id);
        await ctx.saveOwnedTabs();
      }
      ctx.sendResult(id, { tabId: tab.id, url: tab.url });
      return;
    }
    case "SCREENSHOT": {
      const windowId = await focusTab(api, targetId);
      const dataUrl = await api.tabs.captureVisibleTab(windowId ?? 0, { format: "png" });
      ctx.sendResult(id, { ok: true, mimeType: "image/png", dataUrl });
      return;
    }
    case "NAVIGATE":
      await api.tabs.update(targetId, { url: String(message.url) });
      ctx.sendResult(id, { ok: true });
      return;
    default:
      ctx.sendError(id, "unsupported", `Unknown command: ${type}`, false);
  }
}
