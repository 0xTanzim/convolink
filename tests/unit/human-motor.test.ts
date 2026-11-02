import { describe, expect, it } from "bun:test";
import {
  calculateKeystrokeDelays,
  computeTargetCoordinates,
  generateBezierPath,
  getDeliberationPause,
  getHandTransitionPause,
  type BoundingBox,
  type Point,
} from "../../src/adapters/common/human-motor.js";

describe("Human Motor & Cadence Simulation (human-motor)", () => {
  describe("generateBezierPath", () => {
    it("generates a path starting at start and ending at target", () => {
      const start: Point = { x: 100, y: 100 };
      const target: Point = { x: 500, y: 400 };

      const path = generateBezierPath(start, target);
      expect(path.length).toBeGreaterThanOrEqual(10);

      const first = path[0]!;
      const last = path[path.length - 1]!;

      expect(first.x).toBe(100);
      expect(first.y).toBe(100);
      expect(last.x).toBe(500);
      expect(last.y).toBe(400);
    });

    it("produces non-linear S-curve velocity distribution (Fitts's Law)", () => {
      const start: Point = { x: 0, y: 0 };
      const target: Point = { x: 1000, y: 0 };

      const path = generateBezierPath(start, target, { steps: 20 });
      expect(path.length).toBe(21);

      // In an S-curve, step distance in the middle (steps 9-11) is greater than step distance at the start (steps 0-2) and end (steps 18-20)
      const startStepDist = Math.abs(path[1]!.x - path[0]!.x);
      const midStepDist = Math.abs(path[10]!.x - path[9]!.x);
      const endStepDist = Math.abs(path[20]!.x - path[19]!.x);

      expect(midStepDist).toBeGreaterThan(startStepDist);
      expect(midStepDist).toBeGreaterThan(endStepDist);
    });

    it("generates natural curved trajectory deviating from a straight line", () => {
      const start: Point = { x: 0, y: 0 };
      const target: Point = { x: 600, y: 0 };

      // With deviation enabled, middle points should deviate in the y-axis
      const path = generateBezierPath(start, target, { deviation: 40 });
      const hasDeviation = path.some((p) => Math.abs(p.y) > 0);
      expect(hasDeviation).toBe(true);
    });
  });

  describe("computeTargetCoordinates", () => {
    it("computes target coordinates strictly bounded within 35% to 65% of the element box", () => {
      const box: BoundingBox = { left: 100, top: 200, width: 200, height: 100 };

      for (let i = 0; i < 50; i++) {
        const target = computeTargetCoordinates(box);
        expect(target.x).toBeGreaterThanOrEqual(100 + 200 * 0.35);
        expect(target.x).toBeLessThanOrEqual(100 + 200 * 0.65);
        expect(target.y).toBeGreaterThanOrEqual(200 + 100 * 0.35);
        expect(target.y).toBeLessThanOrEqual(200 + 100 * 0.65);
      }
    });
  });

  describe("calculateKeystrokeDelays and pauses", () => {
    it("calculates Gaussian delays with extra pause on punctuation marks", () => {
      const text = "Hello, world! Ready?";
      const delays = calculateKeystrokeDelays(text);

      expect(delays.length).toBe(text.length);

      // Comma index is 5, exclamation is 12, question is 19
      const standardCharDelay = delays[1]!; // 'e'
      const commaDelay = delays[5]!; // ','
      const exclamationDelay = delays[12]!; // '!'

      expect(commaDelay).toBeGreaterThan(standardCharDelay);
      expect(exclamationDelay).toBeGreaterThan(standardCharDelay);
    });

    it("returns deliberation pause between 400ms and 900ms", () => {
      for (let i = 0; i < 20; i++) {
        const pause = getDeliberationPause();
        expect(pause).toBeGreaterThanOrEqual(400);
        expect(pause).toBeLessThanOrEqual(900);
      }
    });

    it("returns hand transition pause between 150ms and 300ms", () => {
      for (let i = 0; i < 20; i++) {
        const pause = getHandTransitionPause();
        expect(pause).toBeGreaterThanOrEqual(150);
        expect(pause).toBeLessThanOrEqual(300);
      }
    });
  });
});
