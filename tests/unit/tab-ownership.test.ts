import { describe, expect, it } from "bun:test";
import { TabOwnership } from "../../src/core/services/tab-ownership.js";

describe("TabOwnership", () => {
  it("allows closing only tabs ConvoLink created", () => {
    const ownership = new TabOwnership([1, 2]);

    expect(ownership.has(1)).toBe(true);
    expect(ownership.canClose(1)).toBe(true);
    expect(ownership.canClose(99)).toBe(false);
    expect(ownership.canClose(99, true)).toBe(true);
  });

  it("forgets a tab once it is closed", () => {
    const ownership = new TabOwnership([5]);
    ownership.remove(5);
    expect(ownership.has(5)).toBe(false);
    expect(ownership.ids()).toEqual([]);
  });

  it("restores persisted ids and ignores invalid ones", () => {
    expect(TabOwnership.from([3, "4", "nope", null]).ids()).toEqual([3, 4]);
    expect(TabOwnership.from(undefined).ids()).toEqual([]);
  });
});
