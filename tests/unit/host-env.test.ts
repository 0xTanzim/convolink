import { describe, expect, it } from "bun:test";
import { HostEnv } from "../../src/core/env/host-env.js";
import os from "node:os";
import path from "node:path";

describe("HostEnv", () => {
  it("resolves the lock directory on Linux using XDG_RUNTIME_DIR", () => {
    const originalXdg = process.env.XDG_RUNTIME_DIR;
    try {
      process.env.XDG_RUNTIME_DIR = "/run/user/1000";
      const lockDir = HostEnv.getLockDir();
      expect(lockDir).toBe("/run/user/1000/convolink");
    } finally {
      if (originalXdg === undefined) {
        delete process.env.XDG_RUNTIME_DIR;
      } else {
        process.env.XDG_RUNTIME_DIR = originalXdg;
      }
    }
  });

  it("falls back to tmpdir when XDG_RUNTIME_DIR is unset", () => {
    const originalXdg = process.env.XDG_RUNTIME_DIR;
    try {
      delete process.env.XDG_RUNTIME_DIR;
      const lockDir = HostEnv.getLockDir();
      expect(lockDir).toBe(path.join(os.tmpdir(), "convolink"));
    } finally {
      if (originalXdg === undefined) {
        delete process.env.XDG_RUNTIME_DIR;
      } else {
        process.env.XDG_RUNTIME_DIR = originalXdg;
      }
    }
  });

  it("resolves data directory using XDG_DATA_HOME", () => {
    const originalXdgData = process.env.XDG_DATA_HOME;
    try {
      process.env.XDG_DATA_HOME = "/home/test/.local/share";
      const dataDir = HostEnv.getDataDir();
      expect(dataDir).toBe("/home/test/.local/share/convolink");
    } finally {
      if (originalXdgData === undefined) {
        delete process.env.XDG_DATA_HOME;
      } else {
        process.env.XDG_DATA_HOME = originalXdgData;
      }
    }
  });

  it("resolves config directory using XDG_CONFIG_HOME or falls back to ~/.config", () => {
    const originalXdgConfig = process.env.XDG_CONFIG_HOME;
    try {
      process.env.XDG_CONFIG_HOME = "/home/test/.config";
      const configDir = HostEnv.getConfigDir();
      expect(configDir).toBe("/home/test/.config/convolink");

      delete process.env.XDG_CONFIG_HOME;
      const fallbackDir = HostEnv.getConfigDir();
      expect(fallbackDir).toBe(path.join(os.homedir(), ".config", "convolink"));
    } finally {
      if (originalXdgConfig === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = originalXdgConfig;
      }
    }
  });

  it("resolves deterministic bridge token path inside config directory", () => {
    const tokenPath = HostEnv.getBridgeTokenPath();
    expect(tokenPath).toBe(path.join(HostEnv.getConfigDir(), "bridge-token.json"));
  });

  it("formats deterministic tab lock paths with targetId", () => {
    const originalXdg = process.env.XDG_RUNTIME_DIR;
    try {
      process.env.XDG_RUNTIME_DIR = "/run/user/1000";
      const lockPath = HostEnv.getTabLockPath("tab-uuid-123");
      expect(lockPath).toBe("/run/user/1000/convolink/tab-tab-uuid-123.lock");
    } finally {
      if (originalXdg === undefined) {
        delete process.env.XDG_RUNTIME_DIR;
      } else {
        process.env.XDG_RUNTIME_DIR = originalXdg;
      }
    }
  });

  it("locates Chrome binary or returns null if not installed", () => {
    const chromePath = HostEnv.findChromeExecutable();
    // On Fedora/Linux dev machine, google-chrome is at /usr/bin/google-chrome
    if (os.platform() === "linux") {
      expect(typeof chromePath === "string" || chromePath === null).toBe(true);
    }
  });

  it("locates specific browser binary dynamically (Brave, Edge, Chrome)", () => {
    const bravePath = HostEnv.findBrowserExecutable("Brave");
    if (bravePath) expect(bravePath.toLowerCase()).toContain("brave");
    else expect(bravePath).toBeNull();

    const edgePath = HostEnv.findBrowserExecutable("Microsoft Edge");
    if (edgePath) expect(edgePath.toLowerCase()).toContain("edge");
    else expect(edgePath).toBeNull();

    const chromePath = HostEnv.findBrowserExecutable("Google Chrome");
    if (chromePath) expect(chromePath.toLowerCase()).toContain("chrome");
    else expect(chromePath).toBeNull();
  });
});
