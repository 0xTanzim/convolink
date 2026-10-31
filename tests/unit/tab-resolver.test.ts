import { describe, expect, it } from "bun:test";
import { TabResolver } from "../../src/core/services/tab-resolver.js";
import { TabNotFoundError } from "../../src/core/errors/bridge-errors.js";
import type { PlatformId, PlatformPort } from "../../src/core/ports/platform.port.js";
import type { TabDescriptor } from "../../src/core/ports/browser.port.js";
import type { DiscoveredTab } from "../../src/core/services/orchestrator.types.js";

function createMockDriver(id: PlatformId, hostPattern: string): PlatformPort {
  return {
    id,
    matchesUrl: (url: string) => url.includes(hostPattern),
    extractThreadId: (url: string) => {
      const match = url.match(new RegExp(`${hostPattern}/(?:c/)?([a-zA-Z0-9_-]+)`));
      return match && match[1] ? match[1] : null;
    },
    getBaseUrl: () => `https://${hostPattern}`,
    getNewChatUrl: () => `https://${hostPattern}/new`,
    resolveSelectors: async () => ({ ok: true, layoutVariant: "standard" }),
    submitPrompt: async () => {},
    readTurns: async () => [],
    awaitCompletion: async () => {},
  } as unknown as PlatformPort;
}

describe("TabResolver", () => {
  const drivers: readonly PlatformPort[] = [
    createMockDriver("chatgpt", "chatgpt.com"),
    createMockDriver("deepseek", "chat.deepseek.com"),
    createMockDriver("gemini", "gemini.google.com"),
  ];

  it("findDriver returns matching driver when URL matches platform pattern", () => {
    const driver = TabResolver.findDriver("https://chatgpt.com/c/chat-123", drivers);
    expect(driver).toBeDefined();
    expect(driver?.id).toBe("chatgpt");
  });

  it("findDriver returns undefined when URL does not match any platform", () => {
    const driver = TabResolver.findDriver("https://github.com/convolink/repo", drivers);
    expect(driver).toBeUndefined();
  });

  it("toDiscoveredTab enriches raw tab descriptor with platform and thread ID", () => {
    const raw: TabDescriptor = {
      targetId: "tab-ds-1",
      title: "DeepSeek Chat",
      url: "https://chat.deepseek.com/c/ds-conv-999",
    };
    const discovered = TabResolver.toDiscoveredTab(raw, drivers);

    expect(discovered.targetId).toBe("tab-ds-1");
    expect(discovered.title).toBe("DeepSeek Chat");
    expect(discovered.url).toBe("https://chat.deepseek.com/c/ds-conv-999");
    expect(discovered.platformId).toBe("deepseek");
    expect(discovered.threadId).toBe("ds-conv-999");
  });

  it("toDiscoveredTab handles unsupported URL gracefully with null platform and thread ID", () => {
    const raw: TabDescriptor = {
      targetId: "tab-unknown",
      title: "Hacker News",
      url: "https://news.ycombinator.com",
    };
    const discovered = TabResolver.toDiscoveredTab(raw, drivers);

    expect(discovered.platformId).toBeNull();
    expect(discovered.threadId).toBeNull();
  });

  describe("resolveTargetTab", () => {
    const tabs: DiscoveredTab[] = [
      { targetId: "t-1", title: "ChatGPT", url: "https://chatgpt.com", platformId: "chatgpt", threadId: "c1" },
      { targetId: "t-2", title: "DeepSeek", url: "https://chat.deepseek.com", platformId: "deepseek", threadId: "d1" },
      { targetId: "t-3", title: "Docs", url: "https://example.com", platformId: null, threadId: null },
    ];

    it("resolves specific tab by targetId", () => {
      const resolved = TabResolver.resolveTargetTab({ targetId: "t-2" }, tabs);
      expect(resolved.targetId).toBe("t-2");
      expect(resolved.platformId).toBe("deepseek");
    });

    it("throws TabNotFoundError when targetId is not found", () => {
      expect(() => TabResolver.resolveTargetTab({ targetId: "t-99" }, tabs)).toThrow(TabNotFoundError);
    });

    it("resolves specific tab by platformId", () => {
      const resolved = TabResolver.resolveTargetTab({ platform: "deepseek" }, tabs);
      expect(resolved.targetId).toBe("t-2");
    });

    it("throws TabNotFoundError when platform is not found among open tabs", () => {
      expect(() => TabResolver.resolveTargetTab({ platform: "claude" }, tabs)).toThrow(TabNotFoundError);
    });

    it("resolves the first supported AI tab by default when neither targetId nor platform is specified", () => {
      const resolved = TabResolver.resolveTargetTab({}, tabs);
      expect(resolved.targetId).toBe("t-1");
      expect(resolved.platformId).toBe("chatgpt");
    });

    it("throws TabNotFoundError when no supported AI tabs exist", () => {
      const unsupportedOnly: DiscoveredTab[] = [
        { targetId: "t-x", title: "None", url: "https://blank.org", platformId: null, threadId: null },
      ];
      expect(() => TabResolver.resolveTargetTab({}, unsupportedOnly)).toThrow(TabNotFoundError);
    });
  });
});
