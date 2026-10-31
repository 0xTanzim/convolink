import { describe, expect, it } from "bun:test";
import { StreamSettlingDetector } from "../../src/adapters/platforms/settling-detector.js";

describe("StreamSettlingDetector Adversarial Stress Harness", () => {
  describe("Signal 1: Immediate rejection on isGenerating: true", () => {
    it("immediately rejects settling regardless of content stability duration", () => {
      const detector = new StreamSettlingDetector(400);

      // Establish baseline at t = 0
      detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 500 }, 0);

      // Stable for 10,000ms -> should normally be settled
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 500 }, 10_000)).toBe(true);

      // But if isGenerating becomes true at 10,001ms, it must immediately reject
      expect(detector.isSettled({ isGenerating: true, isThinking: false, contentLength: 500 }, 10_001)).toBe(false);
      expect(detector.getStableDurationMs(10_001)).toBe(0);
    });

    it("resets stability tracking so subsequent false requires full 400ms quiescence", () => {
      const detector = new StreamSettlingDetector(400);

      // Settle at t = 400
      detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 100 }, 0);
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 100 }, 400)).toBe(true);

      // Flicker isGenerating: true at t = 401
      expect(detector.isSettled({ isGenerating: true, isThinking: false, contentLength: 100 }, 401)).toBe(false);

      // Returns to isGenerating: false at t = 402 -> establishes new baseline
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 100 }, 402)).toBe(false);

      // At t = 801 (elapsed: 399ms from 402ms) -> NOT settled
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 100 }, 801)).toBe(false);

      // At t = 802 (elapsed: 400ms from 402ms) -> SETTLED
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 100 }, 802)).toBe(true);
    });

    it("consistently rejects over 100 consecutive queries while isGenerating is true", () => {
      const detector = new StreamSettlingDetector(400);
      for (let t = 0; t <= 10_000; t += 100) {
        const settled = detector.isSettled({ isGenerating: true, isThinking: false, contentLength: 1_000_000 }, t);
        expect(settled).toBe(false);
      }
    });
  });

  describe("Signal 2: Immediate rejection on isThinking: true", () => {
    it("immediately rejects settling regardless of content stability duration", () => {
      const detector = new StreamSettlingDetector(400);

      // Establish baseline at t = 0
      detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 250 }, 0);
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 250 }, 5_000)).toBe(true);

      // Model re-enters thinking phase at t = 5001
      expect(detector.isSettled({ isGenerating: false, isThinking: true, contentLength: 250 }, 5_001)).toBe(false);
      expect(detector.getStableDurationMs(5_001)).toBe(0);
    });

    it("immediately rejects when both isGenerating and isThinking are true", () => {
      const detector = new StreamSettlingDetector(400);
      detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 300 }, 0);
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 300 }, 1000)).toBe(true);

      expect(detector.isSettled({ isGenerating: true, isThinking: true, contentLength: 300 }, 1050)).toBe(false);
      expect(detector.getStableDurationMs(1050)).toBe(0);
    });

    it("defaults isThinking to false when omitted without rejecting settled content", () => {
      const detector = new StreamSettlingDetector(400);
      detector.isSettled({ isGenerating: false, contentLength: 150 }, 0);
      expect(detector.isSettled({ isGenerating: false, contentLength: 150 }, 400)).toBe(true);
    });
  });

  describe("Signal 3: Stability reset on contentLength mutation", () => {
    it("resets stability when tokens append (forward mutation)", () => {
      const detector = new StreamSettlingDetector(400);
      detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 100 }, 0);

      // 300ms elapsed
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 100 }, 300)).toBe(false);

      // Token appended at t = 350
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 110 }, 350)).toBe(false);

      // At t = 749 (elapsed 399ms from 350) -> NOT settled
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 110 }, 749)).toBe(false);

      // At t = 750 (elapsed 400ms from 350) -> SETTLED
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 110 }, 750)).toBe(true);
    });

    it("resets stability when content is deleted or truncated (backward mutation)", () => {
      const detector = new StreamSettlingDetector(400);
      detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 500 }, 0);
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 500 }, 400)).toBe(true);

      // Truncation/edit at t = 500 (length decreases from 500 to 450)
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 450 }, 500)).toBe(false);

      // At t = 899 (elapsed 399ms from 500) -> NOT settled
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 450 }, 899)).toBe(false);

      // At t = 900 (elapsed 400ms from 500) -> SETTLED
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 450 }, 900)).toBe(true);
    });

    it("never settles during high-frequency token jitter (50ms intervals)", () => {
      const detector = new StreamSettlingDetector(400);
      let length = 100;

      for (let t = 0; t <= 3_000; t += 50) {
        length = length === 100 ? 105 : 100; // oscillating
        const settled = detector.isSettled({ isGenerating: false, isThinking: false, contentLength: length }, t);
        expect(settled).toBe(false);
      }
    });

    it("rejects non-positive content lengths unconditionally", () => {
      const detector = new StreamSettlingDetector(400);
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 0 }, 0)).toBe(false);
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 0 }, 10_000)).toBe(false);
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: -5 }, 10_000)).toBe(false);
    });
  });

  describe("Signal 4: Precise requirement of >= 400ms continuous quiescence", () => {
    it("strictly differentiates 399ms (false) from 400ms (true)", () => {
      const detector = new StreamSettlingDetector(400);
      const start = 1_000_000;

      detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 200 }, start);

      // t = 399ms
      expect(
        detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 200 }, start + 399),
      ).toBe(false);

      // t = 400ms -> exact boundary
      expect(
        detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 200 }, start + 400),
      ).toBe(true);
    });

    it("returns false at every millisecond step from 0 to 399ms", () => {
      const detector = new StreamSettlingDetector(400);
      detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 42 }, 0);

      for (let t = 1; t < 400; t++) {
        const settled = detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 42 }, t);
        expect(settled).toBe(false);
      }

      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 42 }, 400)).toBe(true);
    });

    it("remains settled for subsequent checks past 400ms while stable", () => {
      const detector = new StreamSettlingDetector(400);
      detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 42 }, 0);

      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 42 }, 400)).toBe(true);
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 42 }, 401)).toBe(true);
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 42 }, 1_000)).toBe(true);
      expect(detector.getStableDurationMs(1_000)).toBe(1_000);
    });

    it("honors custom quiescenceMs passed in options over constructor default", () => {
      const detector = new StreamSettlingDetector(400);
      detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 80, quiescenceMs: 600 }, 0);

      // At 400ms -> should NOT settle because options specified 600ms
      expect(
        detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 80, quiescenceMs: 600 }, 400),
      ).toBe(false);

      // At 599ms -> NOT settled
      expect(
        detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 80, quiescenceMs: 600 }, 599),
      ).toBe(false);

      // At 600ms -> SETTLED
      expect(
        detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 80, quiescenceMs: 600 }, 600),
      ).toBe(true);
    });

    it("clears all state on reset() requiring new baseline and fresh 400ms window", () => {
      const detector = new StreamSettlingDetector(400);
      detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 120 }, 0);
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 120 }, 400)).toBe(true);

      detector.reset();
      expect(detector.getStableDurationMs(400)).toBe(0);

      // Next call at t = 500 creates new baseline
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 120 }, 500)).toBe(false);

      // At t = 899 (elapsed 399ms) -> false
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 120 }, 899)).toBe(false);

      // At t = 900 (elapsed 400ms) -> true
      expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 120 }, 900)).toBe(true);
    });
  });
});
