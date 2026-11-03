import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildExtension, buildManifest, getProjectVersion } from "../../scripts/build-extension.js";

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
    // Chromium-only capability: trusted input and tab screenshots.
    expect(manifest.permissions).toContain("debugger");
    expect(manifest.permissions).toContain("activeTab");
    expect(fs.existsSync(path.join(chromeDir, "build-meta.json"))).toBe(true);
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
    // Firefox uses a different debugging protocol; the manifest must not ask for it.
    expect(manifest.permissions).not.toContain("debugger");
  });

  it("generates both manifests from one version and host list", () => {
    const version = getProjectVersion();
    const chrome = buildManifest("chrome", version);
    const firefox = buildManifest("firefox", version);

    expect(chrome.version).toBe(version);
    expect(firefox.version).toBe(version);
    expect(chrome.host_permissions).toEqual([
      "https://chatgpt.com/*",
      "https://chat.deepseek.com/*",
      "https://gemini.google.com/*",
      "https://claude.ai/*",
    ]);
    expect(chrome.host_permissions).toEqual(firefox.host_permissions);
    expect(chrome.permissions).toContain("debugger");
    expect(firefox.permissions).not.toContain("debugger");
  });

  it("has no duplicate manifest or build-output tree left in the source extension", () => {
    const extRoot = path.resolve(import.meta.dir, "../../extensions/convolink-companion");
    expect(fs.existsSync(path.join(extRoot, "manifest.json"))).toBe(false);
    expect(fs.existsSync(path.join(extRoot, "wxt.config.ts"))).toBe(false);
    expect(fs.existsSync(path.join(extRoot, "dist"))).toBe(false);
  });

  it("creates downloadable release zip archives when zip is enabled", async () => {
    const hasZip = Bun.spawnSync(["which", "zip"]).exitCode === 0;
    if (!hasZip) return;

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
