import { describe, expect, it } from "bun:test";
import { ensureProjectProfile, isInteractiveSession } from "../../src/entrypoints/cli.prompt.js";
import { ConfigService } from "../../src/core/services/config.service.js";
import type { DiscoveredProfile } from "../../src/adapters/browsers/browser-discovery.js";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

describe("CLI Interactive Prompt & Profile Auto-Resolution", () => {
  const tmpDir = path.join(os.tmpdir(), `convo-prompt-test-${Date.now()}`);

  const mockProfiles: DiscoveredProfile[] = [
    {
      browser: "Google Chrome",
      profileId: "Default",
      name: "Zack",
      email: "developer@example.com",
      userDataDir: "/home/user/.config/google-chrome",
    },
    {
      browser: "Google Chrome",
      profileId: "Profile 1",
      name: "Personal",
      email: "personal@example.com",
      userDataDir: "/home/user/.config/google-chrome",
    },
  ];

  it("isInteractiveSession returns false when CI or NON_INTERACTIVE is set", () => {
    const origCI = process.env.CI;
    process.env.CI = "true";
    expect(isInteractiveSession()).toBe(false);
    if (origCI !== undefined) process.env.CI = origCI;
    else delete process.env.CI;
  });

  it("returns existing config without prompting if .convo/config.json exists", async () => {
    const configService = new ConfigService(tmpDir);
    await configService.saveConfig({ profileId: "Default", profileEmail: "developer@example.com" });

    let promptCalled = false;
    const resolved = await ensureProjectProfile({
      workDir: tmpDir,
      isInteractive: true,
      discoverProfiles: async () => mockProfiles,
      promptInput: async () => {
        promptCalled = true;
        return "1";
      },
    });

    expect(promptCalled).toBe(false);
    expect(resolved?.profileEmail).toBe("developer@example.com");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("in non-interactive mode, auto-selects default active profile without blocking stdin", async () => {
    const freshTmp = path.join(os.tmpdir(), `convo-non-interactive-${Date.now()}`);
    let promptCalled = false;

    const resolved = await ensureProjectProfile({
      workDir: freshTmp,
      isInteractive: false,
      discoverProfiles: async () => mockProfiles,
      promptInput: async () => {
        promptCalled = true;
        return "2";
      },
    });

    expect(promptCalled).toBe(false);
    expect(resolved).toBeDefined();
    expect(resolved?.profileId).toBe("Default");

    fs.rmSync(freshTmp, { recursive: true, force: true });
  });

  it("in interactive mode, prompts user and persists choice to .convo/config.json", async () => {
    const freshTmp = path.join(os.tmpdir(), `convo-interactive-${Date.now()}`);
    let promptMessage = "";

    const resolved = await ensureProjectProfile({
      workDir: freshTmp,
      isInteractive: true,
      discoverProfiles: async () => mockProfiles,
      promptInput: async (msg) => {
        promptMessage = msg;
        return "2"; // Select option 2
      },
    });

    expect(promptMessage).toContain("Select a profile");
    expect(resolved).toBeDefined();
    expect(resolved?.profileId).toBe("Profile 1");
    expect(resolved?.profileEmail).toBe("personal@example.com");

    // Verify persisted
    const configService = new ConfigService(freshTmp);
    const saved = await configService.loadConfig();
    expect(saved?.profileId).toBe("Profile 1");
    expect(saved?.profileEmail).toBe("personal@example.com");

    fs.rmSync(freshTmp, { recursive: true, force: true });
  });

  it("defaults to option 1 when user presses Enter without typing a number", async () => {
    const freshTmp = path.join(os.tmpdir(), `convo-default-enter-${Date.now()}`);

    const resolved = await ensureProjectProfile({
      workDir: freshTmp,
      isInteractive: true,
      discoverProfiles: async () => mockProfiles,
      promptInput: async () => "", // Empty string = Enter
    });

    expect(resolved?.profileId).toBe("Default");

    fs.rmSync(freshTmp, { recursive: true, force: true });
  });

  it("respects explicit profileArg and saves without prompting", async () => {
    const freshTmp = path.join(os.tmpdir(), `convo-explicit-arg-${Date.now()}`);
    let promptCalled = false;

    const resolved = await ensureProjectProfile({
      workDir: freshTmp,
      profileArg: "2",
      isInteractive: true,
      discoverProfiles: async () => mockProfiles,
      promptInput: async () => {
        promptCalled = true;
        return "1";
      },
    });

    expect(promptCalled).toBe(false);
    expect(resolved?.profileId).toBe("Profile 1");
    expect(resolved?.profileEmail).toBe("personal@example.com");

    const configService = new ConfigService(freshTmp);
    const saved = await configService.loadConfig();
    expect(saved?.profileId).toBe("Profile 1");

    fs.rmSync(freshTmp, { recursive: true, force: true });
  });
});
