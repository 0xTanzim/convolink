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

export async function focusTab(api: ExtensionApi, tabId: number): Promise<number | undefined> {
  const tab = await api.tabs.update(tabId, { active: true });
  if (tab.windowId !== undefined) {
    // Activating a tab inside a minimized window does not render it: Chrome
    // keeps the window hidden, so SPAs never mount the conversation view.
    await api.windows.update(tab.windowId, { focused: true, state: "normal" }).catch(() => undefined);
  }
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
      const seenIds = new Set(tabs.map((tab) => tab.id).filter((tabId): tabId is number => tabId !== undefined));
      for (const ownedId of ownership.ids()) {
        if (!seenIds.has(ownedId)) {
          try {
            const hiddenTab = await api.tabs.get(ownedId);
            if (hiddenTab && hiddenTab.id !== undefined) {
              tabs.push(hiddenTab);
              seenIds.add(ownedId);
            }
          } catch {
            ownership.remove(ownedId);
          }
        }
      }
      await ctx.saveOwnedTabs();
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
      try {
        const dataUrl = await api.tabs.captureVisibleTab(windowId ?? 0, { format: "png" });
        ctx.sendResult(id, { ok: true, mimeType: "image/png", dataUrl });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // captureVisibleTab needs <all_urls> or a user gesture; report it as a
        // capability gap so callers can degrade instead of guessing.
        ctx.sendError(id, "unsupported", `Screenshot unavailable: ${message}`, false);
      }
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
