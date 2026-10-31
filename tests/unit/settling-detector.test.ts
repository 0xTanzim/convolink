import { describe, expect, it } from "bun:test";
import { StreamSettlingDetector } from "../../src/adapters/platforms/settling-detector.js";

describe("StreamSettlingDetector (3-Signal Settling)", () => {
  it("rejects settling when generating action indicator is active", () => {
    const detector = new StreamSettlingDetector(400);
    // Even after 1000ms, if isGenerating is true, must NOT settle
    expect(detector.isSettled({ isGenerating: true, isThinking: false, contentLength: 100 }, 0)).toBe(false);
    expect(detector.isSettled({ isGenerating: true, isThinking: false, contentLength: 100 }, 1000)).toBe(false);
  });

  it("rejects settling when thinking container transition is active", () => {
    const detector = new StreamSettlingDetector(400);
    expect(detector.isSettled({ isGenerating: false, isThinking: true, contentLength: 100 }, 0)).toBe(false);
    expect(detector.isSettled({ isGenerating: false, isThinking: true, contentLength: 100 }, 600)).toBe(false);
  });

  it("rejects settling when content length is zero or empty", () => {
    const detector = new StreamSettlingDetector(400);
    expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 0 }, 0)).toBe(false);
    expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 0 }, 500)).toBe(false);
  });

  it("resets quiescence timer when content length mutates mid-stream", () => {
    const detector = new StreamSettlingDetector(400);

    // Initial token chunk at t = 100
    expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 50 }, 100)).toBe(false);

    // Stable at t = 300 (elapsed: 200ms < 400ms)
    expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 50 }, 300)).toBe(false);

    // New token chunk arrives at t = 400 (content changes to 75 -> resets timer)
    expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 75 }, 400)).toBe(false);

    // At t = 700 (elapsed from reset: 300ms < 400ms)
    expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 75 }, 700)).toBe(false);

    // At t = 800 (elapsed from reset: 400ms >= 400ms) -> SETTLED
    expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 75 }, 800)).toBe(true);
  });

  it("resets quiescence timer if generation or thinking flickers to active mid-window", () => {
    const detector = new StreamSettlingDetector(400);

    expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 100 }, 100)).toBe(false);
    expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 100 }, 300)).toBe(false);

    // Flickers active at t = 350
    expect(detector.isSettled({ isGenerating: true, isThinking: false, contentLength: 100 }, 350)).toBe(false);

    // Stops again at t = 400
    expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 100 }, 400)).toBe(false);

    // Must require another 400ms from t = 400
    expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 100 }, 750)).toBe(false);
    expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 100 }, 800)).toBe(true);
  });

  it("supports configurable quiescenceMs window", () => {
    const detector = new StreamSettlingDetector(200);

    expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 20 }, 100)).toBe(false);
    expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 20 }, 250)).toBe(false);
    expect(detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 20 }, 300)).toBe(true);
  });

  it("clears internal state on reset()", () => {
    const detector = new StreamSettlingDetector(400);
    detector.isSettled({ isGenerating: false, isThinking: false, contentLength: 50 }, 100);
    detector.reset();
    expect(detector.getStableDurationMs()).toBe(0);
  });
});
