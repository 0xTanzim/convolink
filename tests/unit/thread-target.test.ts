import { describe, expect, it } from "bun:test";
import { parseThreadList, parseThreadUrl } from "../../src/core/services/setup/thread-target.js";
import { findThreadTab, latestManagedTab, shouldStartFresh } from "../../src/core/services/tab-plan.js";
import type { DiscoveredTab } from "../../src/core/services/orchestrator.types.js";

const tab = (over: Partial<DiscoveredTab>): DiscoveredTab => ({
  targetId: "t1",
  title: "t",
  url: "https://chatgpt.com/",
  platformId: "chatgpt",
  threadId: null,
  ...over,
});

describe("thread URL parsing", () => {
  it("parses a ChatGPT conversation", () => {
    const parsed = parseThreadUrl("https://chatgpt.com/c/6ae8a0b7-2284-83ee-a2ca-459ab4ed15de");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.target.platform).toBe("chatgpt");
    expect(parsed.target.threadId).toBe("6ae8a0b7-2284-83ee-a2ca-459ab4ed15de");
  });

  it("parses DeepSeek and Claude conversations", () => {
    const deepseek = parseThreadUrl("https://chat.deepseek.com/a/chat/s/64ce5050-7530-4840-a9e2-19f1deaa3507");
    const claude = parseThreadUrl("https://claude.ai/chat/abc-123");
    expect(deepseek.ok && deepseek.target.threadId).toBe("64ce5050-7530-4840-a9e2-19f1deaa3507");
    expect(claude.ok && claude.target.platform).toBe("claude");
  });

  it("rejects http, unknown hosts, and non-conversation URLs", () => {
    expect(parseThreadUrl("http://chatgpt.com/c/x").ok).toBe(false);
    expect(parseThreadUrl("https://evil.example/c/x").ok).toBe(false);
    expect(parseThreadUrl("https://chatgpt.com/").ok).toBe(false);
  });

  it("refuses Gemini conversation URLs but not the platform itself", () => {
    const parsed = parseThreadUrl("https://gemini.google.com/app/abc123");
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe("configuration-invalid");
  });

  it("parses a per-platform thread list and rejects mismatches", () => {
    const ok = parseThreadList("chatgpt=https://chatgpt.com/c/aaa,deepseek=https://chat.deepseek.com/a/chat/s/bbb");
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.targets.map((t) => t.platform)).toEqual(["chatgpt", "deepseek"]);

    const mismatch = parseThreadList("chatgpt=https://chat.deepseek.com/a/chat/s/bbb");
    expect(mismatch.ok).toBe(false);
  });
});

describe("tab planning", () => {
  const managed = new Set(["managed-1"]);

  it("finds a tab already showing the thread", () => {
    const tabs = [tab({ targetId: "u1", threadId: "abc" })];
    expect(findThreadTab(tabs, { platform: "chatgpt", threadId: "abc", url: "https://chatgpt.com/c/abc" })?.targetId).toBe("u1");
  });

  it("never treats a foreign tab as managed", () => {
    const tabs = [tab({ targetId: "user-1" })];
    expect(latestManagedTab(tabs, "chatgpt", (t) => managed.has(t.targetId))).toBeNull();
  });

  it("picks the latest managed tab for the platform", () => {
    const tabs = [
      tab({ targetId: "managed-1" }),
      tab({ targetId: "user-1" }),
      tab({ targetId: "managed-2" }),
    ];
    const ids = new Set(["managed-1", "managed-2"]);
    expect(latestManagedTab(tabs, "chatgpt", (t) => ids.has(t.targetId))?.targetId).toBe("managed-2");
  });

  it("starts fresh for compare unless a thread or continue is requested", () => {
    expect(shouldStartFresh({ hasThread: false, continueThreads: false, freshByDefault: true })).toBe(true);
    expect(shouldStartFresh({ hasThread: true, continueThreads: false, freshByDefault: true })).toBe(false);
    expect(shouldStartFresh({ hasThread: false, continueThreads: true, freshByDefault: true })).toBe(false);
    expect(shouldStartFresh({ hasThread: false, continueThreads: false, freshByDefault: false })).toBe(false);
  });
});
