import { describe, expect, it } from "bun:test";
import { ensureProjectProfile, isInteractiveSession } from "../../src/entrypoints/cli.prompt.js";
import { ConfigService } from "../../src/core/services/config.service.js";
import { ProjectConfigAdapter } from "../../src/adapters/config/project-config.adapter.js";
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
      name: "Work Profile",
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
    const configService = new ConfigService(new ProjectConfigAdapter(), tmpDir);
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
    expect(resolved?.profileId).toBe("Default");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("in non-interactive mode, returns null and never automatically selects a profile without user input", async () => {
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
    expect(resolved).toBeNull();

    // Verify nothing was written to config.json
    const configService = new ConfigService(new ProjectConfigAdapter(), freshTmp);
    const saved = await configService.loadConfig();
    expect(saved).toBeNull();

    fs.rmSync(freshTmp, { recursive: true, force: true });
  });

  it("in interactive mode, prompts user without ranking/recommended tags and persists choice to .convo/config.json", async () => {
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
    expect(promptMessage).not.toContain("default: 1");
    expect(resolved).toBeDefined();
    expect(resolved?.profileId).toBe("Profile 1");
    expect(resolved?.profilePath).toBe("/home/user/.config/google-chrome");

    // Verify persisted
    const configService = new ConfigService(new ProjectConfigAdapter(), freshTmp);
    const saved = await configService.loadConfig();
    expect(saved?.profileId).toBe("Profile 1");
    expect(saved?.profileEmail).toBeUndefined();

    fs.rmSync(freshTmp, { recursive: true, force: true });
  });

  it("never automatically selects option 1 when user submits empty input", async () => {
    const freshTmp = path.join(os.tmpdir(), `convo-no-default-enter-${Date.now()}`);

    const resolved = await ensureProjectProfile({
      workDir: freshTmp,
      isInteractive: true,
      discoverProfiles: async () => mockProfiles,
      promptInput: async () => "", // Empty string = Enter without selection
    });

    expect(resolved).toBeNull();

    const configService = new ConfigService(new ProjectConfigAdapter(), freshTmp);
    const saved = await configService.loadConfig();
    expect(saved).toBeNull();

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
    expect(resolved?.profilePath).toBe("/home/user/.config/google-chrome");

    const configService = new ConfigService(new ProjectConfigAdapter(), freshTmp);
    const saved = await configService.loadConfig();
    expect(saved?.profileId).toBe("Profile 1");

    fs.rmSync(freshTmp, { recursive: true, force: true });
  });

  it("handles skip option (typing '0' or 'skip') by cancelling cleanly without error", async () => {
    const freshTmp = path.join(os.tmpdir(), `convo-skip-${Date.now()}`);

    const resolved = await ensureProjectProfile({
      workDir: freshTmp,
      isInteractive: true,
      discoverProfiles: async () => mockProfiles,
      promptInput: async () => "skip",
    });

    expect(resolved).toBeNull();

    const configService = new ConfigService(new ProjectConfigAdapter(), freshTmp);
    const saved = await configService.loadConfig();
    expect(saved).toBeNull();

    fs.rmSync(freshTmp, { recursive: true, force: true });
  });

  it("handles custom write-in ('Other') input for custom profile directory or email", async () => {
    const freshTmp = path.join(os.tmpdir(), `convo-other-${Date.now()}`);

    const resolved = await ensureProjectProfile({
      workDir: freshTmp,
      isInteractive: true,
      discoverProfiles: async () => mockProfiles,
      promptInput: async () => "/custom/browser/user-data",
    });

    expect(resolved).toBeDefined();
    expect(resolved?.profilePath).toBe("/custom/browser/user-data");

    const configService = new ConfigService(new ProjectConfigAdapter(), freshTmp);
    const saved = await configService.loadConfig();
    expect(saved?.profilePath).toBe("/custom/browser/user-data");

    fs.rmSync(freshTmp, { recursive: true, force: true });
  });

  it("saves transport as firefox-bidi when Zen Browser or Firefox is selected", async () => {
    const freshTmp = path.join(os.tmpdir(), `convo-zen-prompt-${Date.now()}`);
    const zenProfiles: DiscoveredProfile[] = [
      {
        browser: "Zen Browser",
        profileId: "Default (release)",
        name: "Zen Personal",
        email: "zenuser@example.com",
        userDataDir: "/home/user/.config/zen/uc3afs3u.Default (release)",
      },
    ];

    const resolved = await ensureProjectProfile({
      workDir: freshTmp,
      isInteractive: true,
      discoverProfiles: async () => zenProfiles,
      promptInput: async () => "1",
    });

    expect(resolved).toBeDefined();
    expect(resolved?.browser).toBe("Zen Browser");
    expect(resolved?.transport).toBe("firefox-bidi");

    const configService = new ConfigService(new ProjectConfigAdapter(), freshTmp);
    const saved = await configService.loadConfig();
    expect(saved?.transport).toBe("firefox-bidi");

    fs.rmSync(freshTmp, { recursive: true, force: true });
  });

  it("resolveLaunchProfile prevents cross-browser profile pollution", async () => {
    const { resolveLaunchProfile } = await import("../../src/entrypoints/cli.prompt.js");
    const firefoxConfig = {
      browser: "Firefox",
      profilePath: "/home/user/.mozilla/firefox/profile.default",
      profileId: "default",
    };

    const mockDiscovery = {
      getProfilesForBrowser: async (b?: string) => [
        {
          browser: "Google Chrome",
          profileId: "Default",
          name: "Chrome User",
          email: "chrome@example.com",
          userDataDir: "/home/user/.config/google-chrome",
        },
      ],
    };

    // When requested browser is Chrome but config is Firefox, resolve Chrome profile
    const forChrome = await resolveLaunchProfile(firefoxConfig, "chrome", mockDiscovery);
    expect(forChrome.profilePath).toBe("/home/user/.config/google-chrome");
    expect(forChrome.profileDirectory).toBe("Default");

    // When requested browser matches config, keep configured profile
    const forFirefox = await resolveLaunchProfile(firefoxConfig, "firefox", mockDiscovery);
    expect(forFirefox.profilePath).toBe("/home/user/.mozilla/firefox/profile.default");
    expect(forFirefox.profileDirectory).toBe("default");
  });
});
