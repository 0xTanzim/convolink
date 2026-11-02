import { describe, expect, it } from "bun:test";
import { BrowserDiscoveryService } from "../../src/adapters/browsers/browser-discovery.js";
import { ConfigService } from "../../src/core/services/config.service.js";
import { GhostCleanupService } from "../../src/adapters/browsers/ghost-cleanup.js";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

describe("Resilience & Edge-Case Worst-Scenario Suite", () => {
  const tmpDir = path.join(os.tmpdir(), `convo-resilience-${Date.now()}`);

  it("Worst Case 1: Config references non-existent profile path from another developer machine", async () => {
    fs.mkdirSync(path.join(tmpDir, ".convo"), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, ".convo/config.json"),
      JSON.stringify({
        profileId: "foreign-profile",
        profilePath: "/non/existent/path/on/foreign/computer",
        profileEmail: "someone@else.com",
      }),
    );

    const configService = new ConfigService();
    const config = await configService.loadConfig(tmpDir);

    expect(config).toBeDefined();
    // Validates that getEffectiveProfilePath detects the missing path
    const validPath = configService.validateProfilePath(config?.profilePath);
    expect(validPath).toBeNull();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("Worst Case 2: Corrupted or truncated Local State JSON does not crash discovery", async () => {
    const corruptDir = path.join(tmpDir, "corrupted-browser");
    fs.mkdirSync(corruptDir, { recursive: true });
    // Write truncated invalid JSON
    fs.writeFileSync(path.join(corruptDir, "Local State"), '{"profile": {"info_cache": { "invalid": ');

    const discovery = new BrowserDiscoveryService([corruptDir]);
    const profiles = await discovery.discoverProfiles();

    // Must not crash; returns fallback profile
    expect(Array.isArray(profiles)).toBe(true);
    expect(profiles.length).toBe(1);
    expect(profiles[0]?.profileId).toBe("Default");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("Worst Case 3: Completely empty or blank DevToolsActivePort does not crash", async () => {
    const emptyPortDir = path.join(tmpDir, "empty-port");
    fs.mkdirSync(emptyPortDir, { recursive: true });
    fs.writeFileSync(path.join(emptyPortDir, "DevToolsActivePort"), "\n\n");

    const discovery = new BrowserDiscoveryService([emptyPortDir]);
    const portInfo = await discovery.readDevToolsActivePort(emptyPortDir);
    expect(portInfo).toBeNull();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("Worst Case 4: Ghost cleanup strictly protects user home and system root", () => {
    const cleaner = new GhostCleanupService();
    expect(cleaner.isGhostPath(os.homedir())).toBe(false);
    expect(cleaner.isGhostPath("/")).toBe(false);
    expect(cleaner.isGhostPath("/etc")).toBe(false);
    expect(cleaner.isGhostPath("/home/user/.config/google-chrome")).toBe(false);
    expect(cleaner.isGhostPath(path.join(os.homedir(), ".config/convolink/profiles/my-profile"))).toBe(false);
  });
});
