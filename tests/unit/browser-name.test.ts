import { describe, expect, it } from "bun:test";
import { normalizeBrowserName, isGeckoBrowser, isChromiumBrowser } from "../../src/core/env/browser-name.js";

describe("Browser Name Normalization & Protocol Resolution (browser-name)", () => {
  it("normalizes Chrome variants to canonical chrome descriptor", () => {
    const variants = ["chrome", "Google Chrome", "google-chrome", "chromium", "CHROME"];
    for (const v of variants) {
      const res = normalizeBrowserName(v);
      expect(res.id).toBe("chrome");
      expect(res.family).toBe("chromium");
      expect(res.transport).toBe("raw-cdp");
      expect(res.defaultPort).toBe(9222);
      expect(isChromiumBrowser(v)).toBe(true);
      expect(isGeckoBrowser(v)).toBe(false);
    }
  });

  it("normalizes Firefox variants to canonical firefox descriptor", () => {
    const variants = ["firefox", "Firefox", "Mozilla Firefox", "mozilla-firefox", "firefox-dev"];
    for (const v of variants) {
      const res = normalizeBrowserName(v);
      expect(res.id).toBe("firefox");
      expect(res.family).toBe("firefox");
      expect(res.transport).toBe("firefox-bidi");
      expect(res.defaultPort).toBe(9223);
      expect(isGeckoBrowser(v)).toBe(true);
      expect(isChromiumBrowser(v)).toBe(false);
    }
  });

  it("normalizes Zen Browser variants to canonical zen descriptor", () => {
    const variants = ["zen", "Zen Browser", "zen-browser", "ZEN"];
    for (const v of variants) {
      const res = normalizeBrowserName(v);
      expect(res.id).toBe("zen");
      expect(res.family).toBe("firefox");
      expect(res.transport).toBe("firefox-bidi");
      expect(res.defaultPort).toBe(9223);
      expect(isGeckoBrowser(v)).toBe(true);
      expect(isChromiumBrowser(v)).toBe(false);
    }
  });

  it("normalizes Brave and Edge variants with Chromium transport", () => {
    const brave = normalizeBrowserName("Brave Browser");
    expect(brave.id).toBe("brave");
    expect(brave.family).toBe("chromium");
    expect(brave.transport).toBe("raw-cdp");
    expect(brave.defaultPort).toBe(9222);

    const edge = normalizeBrowserName("msedge");
    expect(edge.id).toBe("edge");
    expect(edge.family).toBe("chromium");
    expect(edge.transport).toBe("raw-cdp");
    expect(edge.defaultPort).toBe(9222);
  });

  it("normalizes extension bridge companion variants", () => {
    const companionVariants = ["companion", "extension", "ext", "convolink-ext"];
    for (const v of companionVariants) {
      const res = normalizeBrowserName(v);
      expect(res.id).toBe("companion");
      expect(res.family).toBe("extension");
      expect(res.transport).toBe("extension-bridge");
      expect(res.defaultPort).toBe(9224);
    }
  });

  it("normalizes empty or auto inputs to auto fallback descriptor", () => {
    const autoVariants = [undefined, "", "auto", "any", "default"];
    for (const v of autoVariants) {
      const res = normalizeBrowserName(v);
      expect(res.id).toBe("auto");
      expect(res.family).toBe("chromium");
      expect(res.transport).toBe("raw-cdp");
      expect(res.defaultPort).toBe(9222);
    }
  });
});
