import { describe, expect, it } from "bun:test";
import { BrowserLocator } from "../../src/core/env/browser-locator.js";

describe("BrowserLocator", () => {
  it("prioritizes Chromium on Linux ARM64 over Google Chrome", () => {
    const candidates = BrowserLocator.getCandidatePaths("Google Chrome", {
      platform: "linux",
      arch: "arm64",
    });

    const chromiumIndex = candidates.findIndex((c) => c.includes("chromium"));
    const chromeIndex = candidates.findIndex((c) => c.includes("google-chrome"));

    expect(chromiumIndex).toBeGreaterThanOrEqual(0);
    expect(chromeIndex).toBeGreaterThanOrEqual(0);
    expect(chromiumIndex).toBeLessThan(chromeIndex);
  });

  it("prioritizes Google Chrome on Linux x86_64", () => {
    const candidates = BrowserLocator.getCandidatePaths("Google Chrome", {
      platform: "linux",
      arch: "x86_64",
    });

    const chromeIndex = candidates.findIndex((c) => c.includes("google-chrome"));
    const chromiumIndex = candidates.findIndex((c) => c.includes("chromium"));

    expect(chromeIndex).toBeGreaterThanOrEqual(0);
    expect(chromiumIndex).toBeGreaterThanOrEqual(0);
    expect(chromeIndex).toBeLessThan(chromiumIndex);
  });

  it("includes Flatpak and Snap candidate paths on Linux", () => {
    const candidates = BrowserLocator.getCandidatePaths("Google Chrome", {
      platform: "linux",
      arch: "x86_64",
    });

    expect(candidates.some((c) => c.includes("snap"))).toBe(true);
    expect(candidates.some((c) => c.includes("flatpak"))).toBe(true);
  });

  it("locates browser in macOS System and User Applications folders", () => {
    const candidates = BrowserLocator.getCandidatePaths("Google Chrome", {
      platform: "darwin",
      env: { HOME: "/Users/testuser" },
    });

    expect(candidates).toContain("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
    expect(candidates).toContain("/Users/testuser/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  });

  it("locates Arc and Edge on macOS", () => {
    const arcCandidates = BrowserLocator.getCandidatePaths("Arc", {
      platform: "darwin",
      env: { HOME: "/Users/testuser" },
    });
    expect(arcCandidates).toContain("/Applications/Arc.app/Contents/MacOS/Arc");

    const edgeCandidates = BrowserLocator.getCandidatePaths("Microsoft Edge", {
      platform: "darwin",
      env: { HOME: "/Users/testuser" },
    });
    expect(edgeCandidates).toContain("/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge");
  });

  it("resolves Windows browser paths across LocalAppData and ProgramFiles", () => {
    const candidates = BrowserLocator.getCandidatePaths("Google Chrome", {
      platform: "win32",
      env: {
        LOCALAPPDATA: "C:\\Users\\User\\AppData\\Local",
        PROGRAMFILES: "C:\\Program Files",
        "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
      },
    });

    expect(candidates.some((c) => c.includes("AppData\\Local\\Google\\Chrome"))).toBe(true);
    expect(candidates.some((c) => c.includes("Program Files\\Google\\Chrome"))).toBe(true);
  });

  it("finds browser using injected fileExists function", () => {
    const mockFiles = new Set(["/snap/bin/chromium"]);
    const found = BrowserLocator.findBrowserExecutable("Google Chrome", {
      platform: "linux",
      arch: "arm64",
      fileExists: (p) => mockFiles.has(p),
    });

    expect(found).toBe("/snap/bin/chromium");
  });

  it("returns null if no browser executable exists", () => {
    const found = BrowserLocator.findBrowserExecutable("Google Chrome", {
      platform: "linux",
      arch: "x86_64",
      fileExists: () => false,
    });

    expect(found).toBeNull();
  });

  it("finds any installed browser when browserName is 'any'", () => {
    const mockFiles = new Set(["/usr/bin/brave-browser"]);
    const found = BrowserLocator.findBrowserExecutable("any", {
      platform: "linux",
      fileExists: (p) => mockFiles.has(p),
    });

    expect(found).toBe("/usr/bin/brave-browser");
  });
});
