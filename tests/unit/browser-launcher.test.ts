import { describe, expect, it } from "bun:test";
import { BrowserLauncherService } from "../../src/adapters/browsers/browser-launcher.js";

describe("BrowserLauncherService (Detached Daemon)", () => {
  it("checkPort returns false when port is not listening", async () => {
    const launcher = new BrowserLauncherService();
    // Port 19999 should not be listening
    const online = await launcher.checkPort(19999);
    expect(online).toBe(false);
  });

  it("returns true immediately if browser is already listening on port", async () => {
    let checkCalled = false;
    let spawnCalled = false;

    const launcher = new BrowserLauncherService({
      checkPort: async () => {
        checkCalled = true;
        return true;
      },
      spawnProcess: () => {
        spawnCalled = true;
      },
    });

    const success = await launcher.ensureBrowserRunning({ port: 9222 });
    expect(success).toBe(true);
    expect(checkCalled).toBe(true);
    expect(spawnCalled).toBe(false);
  });

  it("spawns detached process with stdio ignore and polls port until online", async () => {
    let spawnCalled = false;
    let spawnOpts: unknown;
    let pollCount = 0;

    const launcher = new BrowserLauncherService({
      findBinary: () => "/usr/bin/google-chrome",
      checkPort: async () => {
        pollCount++;
        // First check (before spawn) = false, second check (poll) = true
        return pollCount > 1;
      },
      spawnProcess: (_bin, _args, opts) => {
        spawnCalled = true;
        spawnOpts = opts;
      },
    });

    const success = await launcher.ensureBrowserRunning({
      port: 9222,
      profilePath: "/tmp/fake-profile",
      pollIntervalMs: 10,
      timeoutMs: 100,
    });

    expect(success).toBe(true);
    expect(spawnCalled).toBe(true);
    expect(spawnOpts).toEqual({ detached: true, stdio: "ignore" });
  });

  it("returns false cleanly if chrome binary cannot be located", async () => {
    const launcher = new BrowserLauncherService({
      findBinary: () => null,
      checkPort: async () => false,
    });

    const success = await launcher.ensureBrowserRunning({ port: 9222 });
    expect(success).toBe(false);
  });
});
