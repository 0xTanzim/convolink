import { describe, expect, it } from "bun:test";
import {
  computeTurnstileClickCoords,
  getTurnstileDetectionExpr,
} from "../../src/adapters/common/turnstile-detector.js";

describe("Turnstile Viewport Detector (turnstile-detector)", () => {
  it("generates detection expression querying cloudflare challenge containers", () => {
    const expr = getTurnstileDetectionExpr();
    expect(expr).toContain("challenges.cloudflare.com");
    expect(expr).toContain("getBoundingClientRect");
  });

  it("calculates accurate viewport coordinates targeting Turnstile checkbox with jitter", () => {
    const iframeRect = { left: 150, top: 300, width: 300, height: 65 };
    const coords = computeTurnstileClickCoords(iframeRect, () => 0.5);

    // Standard checkbox is left + 28, top + 32; with randomFn returning 0.5 (0 jitter), x = 178, y = 332
    expect(coords.x).toBe(178);
    expect(coords.y).toBe(332);
  });

  it("adds bounded jitter to prevent repeated identical click coordinates", () => {
    const iframeRect = { left: 100, top: 100, width: 300, height: 65 };
    const coords1 = computeTurnstileClickCoords(iframeRect, () => 0.0);
    const coords2 = computeTurnstileClickCoords(iframeRect, () => 1.0);

    expect(coords1.x).not.toBe(coords2.x);
    expect(coords1.y).not.toBe(coords2.y);
    expect(Math.abs(coords1.x - coords2.x)).toBeLessThanOrEqual(8);
  });
});
