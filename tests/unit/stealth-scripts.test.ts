import { describe, expect, it } from "bun:test";
import { getStealthPreloadScript, STEALTH_PRELOAD_SCRIPT } from "../../src/adapters/common/stealth-scripts.js";

describe("Stealth Preload Scripts (stealth-scripts)", () => {
  it("exports a non-empty string for STEALTH_PRELOAD_SCRIPT", () => {
    expect(typeof STEALTH_PRELOAD_SCRIPT).toBe("string");
    expect(STEALTH_PRELOAD_SCRIPT.length).toBeGreaterThan(50);
  });

  it("getStealthPreloadScript returns valid JavaScript containing webdriver scrubbing", () => {
    const script = getStealthPreloadScript();
    expect(script).toContain("webdriver");
    expect(script).toContain("window.chrome");
  });

  it("evaluates cleanly in a simulated browser context without throwing", () => {
    const script = getStealthPreloadScript();

    // Create a mock DOM global
    const fakeNavigator: Record<string, unknown> = { webdriver: true };
    const fakeWindow: Record<string, unknown> = { navigator: fakeNavigator };

    // Function wrapper executing script with fake globals
    const fn = new Function("window", "navigator", script);
    expect(() => fn(fakeWindow, fakeNavigator)).not.toThrow();

    expect(fakeNavigator.webdriver).toBe(false);
    expect(fakeWindow.chrome).toBeDefined();
  });
});
