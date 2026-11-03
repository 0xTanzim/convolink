import { describe, expect, it } from "bun:test";
import { handleSetup } from "../../src/entrypoints/cli.setup.command.js";
import { applySetup } from "../../src/entrypoints/cli.setup.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectConfigAdapter } from "../../src/adapters/config/project-config.adapter.js";

describe("Reports Issues (improves.md / agentic-improvement-roadmap.md)", () => {
  it("Issue 5: handleSetup with --help prints help and exits with code 0 immediately without prompting", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      const exitCode = await handleSetup(["--help"]);
      expect(exitCode).toBe(0);
      expect(output).toContain("Usage: convo setup");
      expect(output).toContain("--browser");
      expect(output).toContain("--save-only");
    } finally {
      console.log = originalLog;
    }
  });

  it("Issue 5: handleSetup with -h prints help and exits with code 0 immediately", async () => {
    let output = "";
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      const exitCode = await handleSetup(["-h"]);
      expect(exitCode).toBe(0);
      expect(output).toContain("Usage: convo setup");
    } finally {
      console.log = originalLog;
    }
  });

  it("Issue 1: applySetup with saveOnly: true persists config even when browser is offline", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "convo-save-only-"));
    try {
      const outcome = await applySetup({
        browserId: "zen",
        browserPath: "/usr/bin/zen",
        profilePath: "/tmp/fake-zen-profile",
        transport: "firefox-bidi",
        workDir: tempDir,
        saveOnly: true,
      });

      expect(outcome.config.browserId).toBe("zen");
      expect(outcome.config.transport).toBe("firefox-bidi");

      const adapter = new ProjectConfigAdapter();
      const saved = await adapter.load(tempDir);
      expect(saved.status).toBe("ok");
      expect(saved.config?.browserId).toBe("zen");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("Issue 1: applySetup with noVerify: true persists config without browser probe", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "convo-no-verify-"));
    try {
      const outcome = await applySetup({
        browserId: "chrome",
        browserPath: "/usr/bin/google-chrome",
        profilePath: "/tmp/fake-chrome-profile",
        transport: "raw-cdp",
        workDir: tempDir,
        noVerify: true,
      });

      expect(outcome.config.browserId).toBe("chrome");

      const adapter = new ProjectConfigAdapter();
      const saved = await adapter.load(tempDir);
      expect(saved.status).toBe("ok");
      expect(saved.config?.browserId).toBe("chrome");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("Issue 5: applySetup throws interactive-unsupported when browser is omitted in non-interactive environment", async () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });

    try {
      await expect(applySetup({})).rejects.toThrow("Interactive browser selection is unavailable in non-interactive environments");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    }
  });

  it("Issue 3: forward transparently recovers and falls back when daemon socket is unreachable (ENOENT)", async () => {
    const { forward, setFallbackOrchestrator } = await import("../../src/entrypoints/mcp.orchestrator.js");
    const fakeDeadClient = {
      sendRequest: async () => {
        const err = new Error("connect ENOENT /run/user/1000/convolink/bridge.sock");
        (err as any).code = "ENOENT";
        throw err;
      },
    } as any;

    const fakeOrch = {
      listTabs: async () => [{ id: "tab-1", title: "Test Tab" }],
    } as any;
    setFallbackOrchestrator(fakeOrch);

    try {
      const caller = forward(fakeDeadClient, "list");
      // Should self-heal by calling in-process fallback without throwing ENOENT
      const result = await caller();
      expect(Array.isArray(result)).toBe(true);
      expect(result).toHaveLength(1);
    } finally {
      setFallbackOrchestrator(null);
    }
  });
});
