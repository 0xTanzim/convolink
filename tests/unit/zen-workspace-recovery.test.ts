import { describe, expect, it } from "bun:test";
import { handleTabCommand, type TabCommandContext } from "../../extensions/convolink-companion/entrypoints/tab-commands.js";
import { TabOwnership } from "../../src/core/services/tab-ownership.js";

describe("Zen Browser Cross-Workspace Tab Recovery", () => {
  it("recovers owned tabs hidden in other Zen workspaces when tabs.query omits them", async () => {
    let savedResult: any = null;
    const owned = new TabOwnership([101, 102]);

    // Simulate Zen Browser behavior: tabs.query({}) only returns workspace 1 tabs (tab 101)
    const mockApi: any = {
      tabs: {
        query: async () => [
          { id: 101, title: "DeepSeek Tab (Workspace 1)", url: "https://chat.deepseek.com/", active: true, windowId: 1 },
        ],
        // Tab 102 is in Workspace 2; tabs.get() can find it even though tabs.query() hid it
        get: async (tabId: number) => {
          if (tabId === 102) {
            return { id: 102, title: "ChatGPT Tab (Workspace 2)", url: "https://chatgpt.com/", active: false, windowId: 1 };
          }
          throw new Error("Tab not found");
        },
      },
    };

    const ctx: TabCommandContext = {
      api: mockApi,
      ownership: owned,
      loadOwnedTabs: async () => {},
      saveOwnedTabs: async () => {},
      sendResult: (_id, result) => { savedResult = result; },
      sendError: () => {},
    };

    await handleTabCommand({ id: 1, type: "LIST_TABS" }, ctx);

    expect(savedResult).not.toBeNull();
    expect(Array.isArray(savedResult)).toBe(true);
    // Both tab 101 and recovered cross-workspace tab 102 should be listed!
    expect(savedResult.length).toBe(2);
    expect(savedResult.some((t: any) => t.tabId === 101)).toBe(true);
    expect(savedResult.some((t: any) => t.tabId === 102)).toBe(true);
    expect(savedResult.find((t: any) => t.tabId === 102).url).toBe("https://chatgpt.com/");
  });
});
