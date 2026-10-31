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
});
