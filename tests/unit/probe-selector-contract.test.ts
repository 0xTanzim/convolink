import { describe, expect, it } from "bun:test";
import { buildMountedProbeExpr, buildReadyProbeExpr } from "../../src/adapters/platforms/page-events.js";

// The extension transport cannot evaluate arbitrary JS, so it reads the
// selector contract out of the probe expression. Positional quote-scanning used
// to pick "complete" out of `readyState !== "complete"` and break every submit.
describe("probe selector contract", () => {
  it("embeds the composer and send selectors for the ready probe", () => {
    const expression = buildReadyProbeExpr("#prompt-textarea", 'button[aria-label="Send"]');
    expect(expression).toContain("convolink:selectors");
    const match = expression.match(/\/\*\s*convolink:selectors\s+(\{[\s\S]*?\})\s*\*\//);
    expect(match).not.toBeNull();
    const contract = JSON.parse(match![1]!);
    expect(contract).toEqual({ composer: "#prompt-textarea", send: 'button[aria-label="Send"]' });
  });

  it("embeds the composer selector for the mounted probe", () => {
    const expression = buildMountedProbeExpr("#prompt-textarea");
    const match = expression.match(/\/\*\s*convolink:selectors\s+(\{[\s\S]*?\})\s*\*\//);
    expect(match).not.toBeNull();
    expect(JSON.parse(match![1]!)).toEqual({ composer: "#prompt-textarea" });
  });

  it("keeps the probes valid JavaScript after the comment", () => {
    expect(buildReadyProbeExpr("#a", "#b")).toContain("return !(send.disabled");
    expect(buildMountedProbeExpr("#a")).toContain('document.readyState === "complete"');
  });
});
