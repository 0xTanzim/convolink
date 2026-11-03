import { describe, expect, it } from "bun:test";
import { buildReadyExpr, buildSettleExpr, buildStatusProbeExpr } from "../../src/adapters/platforms/page-events.js";

describe("buildReadyExpr", () => {
  it("waits for a complete document, a mounted composer and an enabled send", () => {
    const expr = buildReadyExpr("textarea#chat-input", "button[aria-label='Send']");

    expect(expr).toContain("document.readyState");
    expect(expr).toContain("querySelector");
    expect(expr).toContain("setInterval");
    expect(expr).toContain("Promise");
    expect(expr).toContain(JSON.stringify("textarea#chat-input"));
    expect(expr).toContain(JSON.stringify("button[aria-label='Send']"));
  });

  it("requires consecutive stable samples before resolving", () => {
    expect(buildReadyExpr("c", "s", { stableSamples: 3 })).toContain("stable >= 3");
  });

  it("is bounded instead of waiting forever", () => {
    expect(buildReadyExpr("c", "s", { maxWaitMs: 1234 })).toContain("1234");
  });
});

describe("buildSettleExpr", () => {
  it("wraps a status expression in a promise that waits for quiescence", () => {
    const expr = buildSettleExpr("({ isGenerating: false, hasNewTurn: true, text: 'x' })", {
      quiescenceMs: 500,
      maxWaitMs: 9000,
    });

    expect(expr).toContain("MutationObserver");
    expect(expr).toContain("isGenerating: false");
    expect(expr).toContain("500");
    expect(expr).toContain("9000");
    expect(expr).toContain("timedOut");
  });

  it("treats thinking as still working", () => {
    const expr = buildSettleExpr("({ isThinking: true })");
    expect(expr).toContain("status.isThinking");
  });

  it("defaults to a bounded wait", () => {
    const expr = buildSettleExpr("({})");
    expect(expr).toContain("120000");
    expect(expr).toContain("400");
  });
});


describe("buildStatusProbeExpr", () => {
  it("does not invoke an already self-invoking status expression twice", () => {
    const status = "(() => ({ turnsCount: 2, hasNewTurn: true, text: 'hello' }))()";
    const probe = buildStatusProbeExpr(status);

    expect(probe).toBe(status);
    expect(new Function(`return ${probe}`)()).toEqual({ turnsCount: 2, hasNewTurn: true, text: "hello" });
  });
});
