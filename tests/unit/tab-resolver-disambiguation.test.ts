import { describe, expect, it } from "bun:test";
import { TabResolver } from "../../src/core/services/tab-resolver.js";
import { AmbiguousTabError, TabNotFoundError } from "../../src/core/errors/bridge-errors.js";
import type { DiscoveredTab } from "../../src/core/services/orchestrator.types.js";

describe("TabResolver Shorthand & Disambiguation Guard", () => {
  const tabs: DiscoveredTab[] = [
    { targetId: "hex-tab-aaa", title: "ChatGPT - Luna Mission Plan", url: "https://chatgpt.com/c/luna-1", platformId: "chatgpt", threadId: "luna-1" },
    { targetId: "hex-tab-bbb", title: "ChatGPT - Personal Account", url: "https://chatgpt.com/c/pers-2", platformId: "chatgpt", threadId: "pers-2" },
    { targetId: "hex-tab-ccc", title: "DeepSeek - Architecture Review", url: "https://chat.deepseek.com/c/arch-3", platformId: "deepseek", threadId: "arch-3" },
    { targetId: "hex-tab-ddd", title: "GitHub PR #42", url: "https://github.com/org/repo/pull/42", platformId: null, threadId: null },
  ];

  it("resolves tab using 1-based index shorthand #1, #2, @1, or plain number", () => {
    const tab1 = TabResolver.resolveTargetTab({ targetId: "#1" }, tabs);
    expect(tab1.targetId).toBe("hex-tab-aaa");
    expect(tab1.title).toContain("Luna");

    const tab2 = TabResolver.resolveTargetTab({ targetId: "#2" }, tabs);
    expect(tab2.targetId).toBe("hex-tab-bbb");

    const tab3 = TabResolver.resolveTargetTab({ targetId: "@3" }, tabs);
    expect(tab3.targetId).toBe("hex-tab-ccc");

    const tab1Plain = TabResolver.resolveTargetTab({ targetId: "1" }, tabs);
    expect(tab1Plain.targetId).toBe("hex-tab-aaa");
  });

  it("throws TabNotFoundError when index shorthand is out of range", () => {
    expect(() => TabResolver.resolveTargetTab({ targetId: "#99" }, tabs)).toThrow(TabNotFoundError);
    expect(() => TabResolver.resolveTargetTab({ targetId: "#0" }, tabs)).toThrow(TabNotFoundError);
  });

  it("throws AmbiguousTabError when multiple tabs match requested platform with disallowAmbiguous=true", () => {
    expect(() =>
      TabResolver.resolveTargetTab({ platform: "chatgpt", disallowAmbiguous: true }, tabs),
    ).toThrow(AmbiguousTabError);
  });

  it("throws AmbiguousTabError when multiple supported AI tabs exist without explicit target with disallowAmbiguous=true", () => {
    expect(() =>
      TabResolver.resolveTargetTab({ disallowAmbiguous: true }, tabs),
    ).toThrow(AmbiguousTabError);
  });

  it("returns candidates list in AmbiguousTabError details", () => {
    try {
      TabResolver.resolveTargetTab({ platform: "chatgpt", disallowAmbiguous: true }, tabs);
      expect(true).toBe(false); // should not reach
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(AmbiguousTabError);
      const ambig = err as AmbiguousTabError;
      expect(ambig.candidates.length).toBe(2);
      expect(ambig.candidates[0]?.targetId).toBe("hex-tab-aaa");
      expect(ambig.candidates[1]?.targetId).toBe("hex-tab-bbb");
    }
  });

  it("resolves cleanly when only a single tab matches the requested platform even with disallowAmbiguous=true", () => {
    const resolved = TabResolver.resolveTargetTab({ platform: "deepseek", disallowAmbiguous: true }, tabs);
    expect(resolved.targetId).toBe("hex-tab-ccc");
    expect(resolved.platformId).toBe("deepseek");
  });
});
