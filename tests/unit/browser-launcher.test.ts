import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
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

  it("passes --profile-directory and --no-first-run to bypass profile picker", async () => {
    let capturedArgs: string[] = [];
    let checked = false;

    const launcher = new BrowserLauncherService({
      findBinary: (browser) => `/usr/bin/${browser?.toLowerCase() || "google-chrome"}`,
      checkPort: async () => {
        if (!checked) {
          checked = true;
          return false;
        }
        return true;
      },
      spawnProcess: (_bin, args) => {
        capturedArgs = args;
      },
    });

    await launcher.ensureBrowserRunning({
      profilePath: "/tmp/fake-brave",
      profileDirectory: "Profile 1",
      browser: "Brave",
    });

    expect(capturedArgs).toContain("--user-data-dir=/tmp/fake-brave");
    expect(capturedArgs).toContain("--profile-directory=Profile 1");
    expect(capturedArgs).toContain("--no-first-run");
  });

  it("falls back to 'Default' when profileDirectory does not exist inside profilePath to prevent ghost profile creation", async () => {
    let capturedArgs: string[] = [];
    let checked = false;

    const tmpDataDir = path.join(os.tmpdir(), `convo-ghost-prevent-${Date.now()}`);
    fs.mkdirSync(path.join(tmpDataDir, "Default"), { recursive: true });

    try {
      const launcher = new BrowserLauncherService({
        findBinary: () => "/usr/bin/google-chrome",
        checkPort: async () => {
          if (!checked) {
            checked = true;
            return false;
          }
          return true;
        },
        spawnProcess: (_bin, args) => {
          capturedArgs = args;
        },
      });

      await launcher.ensureBrowserRunning({
        profilePath: tmpDataDir,
        profileDirectory: "zack-ai",
        browser: "Google Chrome",
      });

      expect(capturedArgs).toContain(`--user-data-dir=${tmpDataDir}`);
      expect(capturedArgs).toContain("--profile-directory=Default");
      expect(capturedArgs).not.toContain("--profile-directory=zack-ai");
    } finally {
      fs.rmSync(tmpDataDir, { recursive: true, force: true });
    }
  });

  it("passes -profile and avoids Chromium-specific flags when launching Firefox", async () => {
    let capturedArgs: string[] = [];
    let checked = false;

    const launcher = new BrowserLauncherService({
      findBinary: () => "/usr/bin/firefox",
      checkPort: async () => {
        if (!checked) {
          checked = true;
          return false;
        }
        return true;
      },
      spawnProcess: (_bin, args) => {
        capturedArgs = args;
      },
    });

    await launcher.ensureBrowserRunning({
      profilePath: "/home/user/.mozilla/firefox/vnwp8i57.default-release",
      browser: "Firefox",
      headless: true,
    });

    expect(capturedArgs).toContain("--remote-debugging-port=9223");
    expect(capturedArgs).toContain("-no-remote");
    expect(capturedArgs).toContain("--remote-allow-origins=*");
    expect(capturedArgs).toContain("-profile");
    expect(capturedArgs).toContain("/home/user/.mozilla/firefox/vnwp8i57.default-release");
    expect(capturedArgs).toContain("-headless");
    expect(capturedArgs.some((a) => a.includes("--user-data-dir"))).toBe(false);
    expect(capturedArgs.some((a) => a.includes("--no-first-run"))).toBe(false);
  });

  it("passes -profile and avoids Chromium-specific flags when launching Zen Browser", async () => {
    let capturedArgs: string[] = [];
    let checked = false;

    const launcher = new BrowserLauncherService({
      findBinary: () => "/home/user/.local/bin/zen",
      checkPort: async () => {
        if (!checked) {
          checked = true;
          return false;
        }
        return true;
      },
      spawnProcess: (_bin, args) => {
        capturedArgs = args;
      },
    });

    await launcher.ensureBrowserRunning({
      profilePath: "/home/user/.config/zen/uc3afs3u.Default (release)",
      browser: "Zen Browser",
    });

    expect(capturedArgs).toContain("--remote-debugging-port=9223");
    expect(capturedArgs).toContain("-no-remote");
    expect(capturedArgs).toContain("-profile");
    expect(capturedArgs).toContain("/home/user/.config/zen/uc3afs3u.Default (release)");
    expect(capturedArgs.some((a) => a.includes("--user-data-dir"))).toBe(false);
  });

  it("detects when profile directory is locked by a living process", () => {
    const launcher = new BrowserLauncherService();
    // Test with non-existent dir
    const notLocked = launcher.isProfileLocked("/tmp/nonexistent-profile-12345");
    expect(notLocked.locked).toBe(false);

    // Test with current process PID via a temporary lock
    const tmpDir = `/tmp/test-profile-lock-${Date.now()}`;
    const fs = require("node:fs");
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
      fs.symlinkSync(`hostname-${process.pid}`, `${tmpDir}/SingletonLock`);
      const locked = launcher.isProfileLocked(tmpDir);
      expect(locked.locked).toBe(true);
      expect(locked.pid).toBe(process.pid);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }

    // Test with Firefox / Zen symlink format (lock -> 127.0.0.1:+<pid>)
    const geckoTmpDir = `/tmp/test-gecko-lock-${Date.now()}`;
    fs.mkdirSync(geckoTmpDir, { recursive: true });
    try {
      fs.symlinkSync(`127.0.0.1:+${process.pid}`, `${geckoTmpDir}/lock`);
      const locked = launcher.isProfileLocked(geckoTmpDir);
      expect(locked.locked).toBe(true);
      expect(locked.pid).toBe(process.pid);
    } finally {
      fs.rmSync(geckoTmpDir, { recursive: true, force: true });
    }
  });

  it("automatically unlinks stale gecko lock files when the holding PID is dead", async () => {
    const fs = require("node:fs");
    const path = require("node:path");
    const tmpDir = `/tmp/test-gecko-stale-lock-${Date.now()}`;
    fs.mkdirSync(tmpDir, { recursive: true });
    const lockPath = path.join(tmpDir, "lock");
    const parentLockPath = path.join(tmpDir, ".parentlock");

    // Dead PID 999999
    fs.symlinkSync("127.0.0.1:+999999", lockPath);
    fs.writeFileSync(parentLockPath, "");

    let spawned = false;
    let checkCount = 0;
    const launcher = new BrowserLauncherService({
      findBinary: () => "/usr/bin/firefox",
      checkPort: async () => {
        checkCount++;
        return checkCount > 1; // false on first check, true on second
      },
      spawnProcess: () => {
        spawned = true;
      },
    });

    try {
      await launcher.ensureBrowserRunning({
        profilePath: tmpDir,
        browser: "firefox",
      });

      expect(spawned).toBe(true);
      expect(fs.existsSync(lockPath)).toBe(false);
      expect(fs.existsSync(parentLockPath)).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("appends container-safe headless flags when headless option is true", async () => {
    let capturedArgs: string[] = [];

    const launcher = new BrowserLauncherService({
      findBinary: () => "/usr/bin/google-chrome",
      checkPort: async () => false,
      spawnProcess: (_bin, args) => {
        capturedArgs = args;
      },
    });

    await launcher.ensureBrowserRunning({
      headless: true,
      timeoutMs: 50,
      pollIntervalMs: 10,
    });

    expect(capturedArgs).toContain("--headless=new");
    expect(capturedArgs).toContain("--disable-gpu");
    expect(capturedArgs).toContain("--disable-dev-shm-usage");
    expect(capturedArgs).toContain("--no-sandbox");
  });

  it("probes WSL gateway IP when running in WSL and loopback port is closed", async () => {
    const probedUrls: string[] = [];
    const launcher = new BrowserLauncherService({
      checkPort: async (_port, host) => {
        probedUrls.push(host || "127.0.0.1");
        return host === "172.28.0.1";
      },
      isWsl: () => true,
      getWslGateway: () => "172.28.0.1",
    });

    const isRunning = await launcher.checkPort(9222);
    expect(isRunning).toBe(true);
    expect(probedUrls).toContain("127.0.0.1");
    expect(probedUrls).toContain("172.28.0.1");
  });
});
