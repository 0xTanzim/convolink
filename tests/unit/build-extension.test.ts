import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildExtension } from "../../scripts/build-extension.js";

describe("Extension Build & Packaging Pipeline", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "convolink-ext-build-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("builds clean Chromium MV3 extension package", async () => {
    const chromeDir = path.join(tempDir, "chrome-mv3");
    const result = await buildExtension({ target: "chrome", outDir: chromeDir, zip: false });

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(chromeDir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(chromeDir, "background.js"))).toBe(true);
    expect(fs.existsSync(path.join(chromeDir, "popup.html"))).toBe(true);
    expect(fs.existsSync(path.join(chromeDir, "popup.js"))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(chromeDir, "manifest.json"), "utf-8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toContain("scripting");
    expect(manifest.permissions).toContain("tabs");
    expect(manifest.permissions).toContain("alarms");
    expect(manifest.permissions).not.toContain("debugger");
    expect(manifest.background.service_worker).toBe("background.js");
  });

  it("builds clean Firefox MV3 extension package with gecko settings", async () => {
    const firefoxDir = path.join(tempDir, "firefox-mv3");
    const result = await buildExtension({ target: "firefox", outDir: firefoxDir, zip: false });

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(firefoxDir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(path.join(firefoxDir, "background.js"))).toBe(true);

    const manifest = JSON.parse(fs.readFileSync(path.join(firefoxDir, "manifest.json"), "utf-8"));
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.scripts).toEqual(["background.js"]);
    expect(manifest.browser_specific_settings?.gecko?.id).toBe("companion@convolink.local");
  });

  it("creates downloadable release zip archives when zip is enabled", async () => {
    const distDir = path.join(tempDir, "release-dist");
    const result = await buildExtension({ target: "chrome", outDir: distDir, zip: true, version: "2.1.0" });

    expect(result.success).toBe(true);
    expect(result.zipPath).toBeDefined();
    expect(fs.existsSync(result.zipPath!)).toBe(true);
    expect(result.zipPath!.endsWith(".zip")).toBe(true);
    expect(result.versionedZipPath).toBeDefined();
    expect(fs.existsSync(result.versionedZipPath!)).toBe(true);
    expect(result.versionedZipPath!).toContain("v2.1.0");

    const manifest = JSON.parse(fs.readFileSync(path.join(distDir, "manifest.json"), "utf-8"));
    expect(manifest.version).toBe("2.1.0");
  });
});
