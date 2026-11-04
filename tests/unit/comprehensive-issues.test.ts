import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { buildCapabilities } from "../../src/entrypoints/cli.doctor.js";
import { findWorkspaceRoot } from "../../src/entrypoints/config-context.js";
import { TabManagerService } from "../../src/core/services/tab-manager.service.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { DefaultTabReadinessAdapter } from "../../src/adapters/platforms/tab-readiness.adapter.js";
import { AuthChallengeError } from "../../src/core/errors/bridge-errors.js";
import type { BrowserPort, SessionHandle, TabDescriptor } from "../../src/core/ports/browser.port.js";
import type { PlatformPort } from "../../src/core/ports/platform.port.js";
import type { DiscoveredTab } from "../../src/core/services/orchestrator.types.js";

describe("Comprehensive Issues (comprehensive-issue-report.md)", () => {
  describe("ISSUE-04: Ghost Session Detection in convo doctor", () => {
    it("diagnoses ghost BiDi session and recommends --restart when active BiDi session error occurs", async () => {
      const items = await buildCapabilities({
        resolution: {
          browserId: "zen",
          transport: "firefox-bidi",
          endpoint: "ws://127.0.0.1:9223/session",
        },
        transportOk: false,
        transportError: "Firefox already has an active BiDi session held by another client.",
      });

      const endpointItem = items.find((i) => i.id === "debug-endpoint");
      expect(endpointItem).toBeDefined();
      expect(endpointItem?.state).toBe("fail");
      expect(endpointItem?.detail).toContain("ghost BiDi session");
      expect(endpointItem?.remediation).toBe("convo connect --zen --restart");
    });

    it("diagnoses ghost BiDi session for firefox with --restart recommendation", async () => {
      const items = await buildCapabilities({
        resolution: {
          browserId: "firefox",
          transport: "firefox-bidi",
          endpoint: "ws://127.0.0.1:9223/session",
        },
        transportOk: false,
        transportError: "Maximum number of active sessions",
      });

      const endpointItem = items.find((i) => i.id === "debug-endpoint");
      expect(endpointItem).toBeDefined();
      expect(endpointItem?.state).toBe("fail");
      expect(endpointItem?.detail).toContain("ghost BiDi session");
      expect(endpointItem?.remediation).toBe("convo connect --firefox --restart");
    });
  });

  describe("ISSUE-05: Upward Directory Traversal in findWorkspaceRoot", () => {
    it("finds workspace root containing .convo/config.json when starting in a nested subdirectory", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-root-test-"));
      const convoDir = path.join(tempDir, ".convo");
      fs.mkdirSync(convoDir, { recursive: true });
      fs.writeFileSync(path.join(convoDir, "config.json"), JSON.stringify({ browserId: "zen" }));

      const nestedSubdir = path.join(tempDir, "src", "sub", "deep");
      fs.mkdirSync(nestedSubdir, { recursive: true });

      const found = findWorkspaceRoot(nestedSubdir);
      expect(found).toBe(tempDir);

      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("stops at git root or returns undefined when no .convo exists", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-no-root-test-"));
      const nested = path.join(tempDir, "a", "b");
      fs.mkdirSync(nested, { recursive: true });

      const found = findWorkspaceRoot(nested);
      expect(found).toBeUndefined();

      fs.rmSync(tempDir, { recursive: true, force: true });
    });
  });

  describe("ISSUE-08: Autonomous Tab Self-Provisioning in resolveOrAutoOpenTab", () => {
    it("auto-provisions a new tab when no managed tab exists for the platform", async () => {
      let createdTabUrl: string | null = null;
      const fakeBrowser = {
        id: "firefox-bidi",
        capabilities: {
          protocol: "webdriver-bidi", browserFamily: "firefox", supportsBackgroundLifecycle: false, supportsFileDownloads: false, supportsTabManagement: true,
        },
        health: async () => ({ ok: true, adapterId: "firefox-bidi", endpoint: "", openTabsCount: 0, latencyMs: 5 }),
        listTabs: async () => [],
        attach: async (targetId: string) => ({ sessionId: "s1", targetId, adapterId: "firefox-bidi" }),
        detach: async () => {},
        evaluate: async () => ({}),
        fillText: async () => {},
        click: async () => {},
        pressKey: async () => {},
        createTab: async (url: string) => {
          createdTabUrl = url;
          return { targetId: "tab-new-deepseek", title: "New Tab", url };
        },
      } as unknown as BrowserPort;

      const fakeDeepSeekDriver = {
        id: "deepseek",
        getBaseUrl: () => "https://chat.deepseek.com/",
        matchesUrl: (u: string) => u.includes("chat.deepseek.com"),
        extractThreadId: () => "t1",
        resolveSelectors: async () => ({ ok: true, layoutVariant: "default" }),
        readThread: async () => ({ layoutVariant: "default", turns: [] }),
        submitPrompt: async () => ({ turnCount: 1, lastTurnHash: "", submittedPromptHash: "" }),
        awaitCompletion: async () => ({ text: "ok", turnsCount: 1, isGenerating: false, isThinking: false }),
      } as unknown as PlatformPort;

      const lockService = new LockService();
      const tabManager = new TabManagerService(fakeBrowser, [fakeDeepSeekDriver], lockService);

      const resolved = await tabManager.resolveOrAutoOpenTab({ platform: "deepseek" }, []);

      expect(resolved.targetId).toBe("tab-new-deepseek");
      expect(String(createdTabUrl)).toBe("https://chat.deepseek.com/");
    });
  });

  describe("ISSUE-09: Turnstile Challenge Detection in TabReadinessAdapter", () => {
    it("throws AuthChallengeError immediately when Turnstile iframe is detected during readiness", async () => {
      const fakeBrowser = {
        id: "firefox-bidi",
        capabilities: {
          protocol: "webdriver-bidi", browserFamily: "firefox", supportsBackgroundLifecycle: false, supportsFileDownloads: false, supportsTabManagement: true,
        },
        health: async () => ({ ok: true, adapterId: "firefox-bidi", endpoint: "", openTabsCount: 1, latencyMs: 5 }),
        listTabs: async () => [],
        attach: async (targetId: string) => ({ sessionId: "s1", targetId, adapterId: "firefox-bidi" }),
        detach: async () => {},
        evaluate: async (_handle: SessionHandle, expr: string) => {
          if (expr.includes("challenges.cloudflare.com")) {
            return { detected: true, isInteractive: true };
          }
          return { composerSelector: null };
        },
        fillText: async () => {},
        click: async () => {},
        pressKey: async () => {},
      } as unknown as BrowserPort;

      const fakeDriver = {
        id: "deepseek",
        getBaseUrl: () => "https://chat.deepseek.com/",
        matchesUrl: (u: string) => u.includes("chat.deepseek.com"),
        extractThreadId: () => "t1",
        resolveSelectors: async () => ({ ok: false, layoutVariant: null }),
        readThread: async () => ({ layoutVariant: "default", turns: [] }),
        submitPrompt: async () => ({ turnCount: 1, lastTurnHash: "", submittedPromptHash: "" }),
        awaitCompletion: async () => ({ text: "ok", turnsCount: 1, isGenerating: false, isThinking: false }),
      } as unknown as PlatformPort;

      const adapter = new DefaultTabReadinessAdapter();
      const handle: SessionHandle = { sessionId: "s1", targetId: "tab-1", adapterId: "firefox-bidi" };

      expect(adapter.waitUntilUsable(fakeBrowser, handle, fakeDriver, 1000)).rejects.toThrow(AuthChallengeError);
    });
  });
});
