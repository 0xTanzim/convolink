import { describe, it, expect, mock } from "bun:test";
import { RawCdpAdapter } from "../../src/adapters/browsers/raw-cdp.adapter.js";
import { pollUntilSettled } from "../../src/adapters/platforms/driver-helpers.js";
import { ComparisonEngineService } from "../../src/core/services/comparison-engine.service.js";
import { buildChromiumArgs, buildGeckoUserPrefs } from "../../src/adapters/browsers/browser-launcher.js";
import type { BrowserPort, SessionHandle } from "../../src/core/ports/browser.port.js";
import type { DiscoveredTab } from "../../src/core/services/orchestrator.types.js";

describe("Background Tab Throttling & Multi-Tab Compare", () => {
  describe("RawCdpAdapter Silent Focus Emulation", () => {
    it("dispatches Emulation.setFocusEmulationEnabled, Page.setWebLifecycleState, and Emulation.setPageVisibilityState in keepAliveInBackground", async () => {
      const adapter = new RawCdpAdapter(9222);
      const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
      const evaluatedExpressions: string[] = [];

      // Intercept internal send and evaluate
      (adapter as any).send = mock(async (_targetId: string, method: string, params: Record<string, unknown>) => {
        commands.push({ method, params });
        return {};
      });
      adapter.evaluate = mock(async (_handle: SessionHandle, expression: string) => {
        evaluatedExpressions.push(expression);
        return true as any;
      });

      const handle: SessionHandle = {
        sessionId: "cdp-test-session",
        targetId: "target-123",
        adapterId: "raw-cdp",
      };

      await adapter.keepAliveInBackground(handle);

      const methodNames = commands.map((c) => c.method);
      expect(methodNames).toContain("Emulation.setFocusEmulationEnabled");
      expect(methodNames).toContain("Page.setWebLifecycleState");
      expect(methodNames).toContain("Emulation.setPageVisibilityState");

      const focusCall = commands.find((c) => c.method === "Emulation.setFocusEmulationEnabled");
      expect(focusCall?.params).toEqual({ enabled: true });

      const lifecycleCall = commands.find((c) => c.method === "Page.setWebLifecycleState");
      expect(lifecycleCall?.params).toEqual({ state: "active" });

      const visibilityCall = commands.find((c) => c.method === "Emulation.setPageVisibilityState");
      expect(visibilityCall?.params).toEqual({ visibilityState: "visible" });

      expect(evaluatedExpressions.length).toBeGreaterThan(0);
      expect(evaluatedExpressions[0]).toContain("visibilityState");
    });
  });

  describe("pollUntilSettled Periodic Throttling Watchdog", () => {
    it("re-invokes keepAliveInBackground periodically when content has not grown", async () => {
      let keepAliveCount = 0;
      const fakeBrowser: Partial<BrowserPort> = {
        id: "raw-cdp",
        keepAliveInBackground: mock(async () => {
          keepAliveCount++;
        }),
        evaluate: mock((async () => {
          return {
            hasNewTurn: true,
            isGenerating: true,
            assistantText: "",
          };
        }) as any),
      };

      const handle: SessionHandle = {
        sessionId: "test-sess",
        targetId: "target-watchdog",
        adapterId: "raw-cdp",
      };

      // Run pollUntilSettled with a short timeout and small watchdog threshold
      const start = Date.now();
      const promise = pollUntilSettled(
        fakeBrowser as BrowserPort,
        handle,
        "probeStatus()",
        {
          timeoutMs: 350,
          quiescenceMs: 50,
          watchdogIntervalMs: 100, // Trigger watchdog every 100ms when stalled
          textOf: (s) => s.assistantText ?? "",
          isNew: (s) => Boolean(s.hasNewTurn),
        },
      );

      const res = await promise;
      expect(res.timedOut).toBe(true);
      // At least initial call + 2 periodic watchdog nudges
      expect(keepAliveCount).toBeGreaterThanOrEqual(2);
    });
  });

  describe("ComparisonEngineService Focus Cycler for Gecko/BiDi", () => {
    it("cycles active focus among pending tabs during parallel execution", async () => {
      const cycledTabs: string[] = [];
      const tabs: DiscoveredTab[] = [
        { targetId: "tab-deepseek", platformId: "deepseek", url: "https://chat.deepseek.com", title: "DeepSeek", threadId: null },
        { targetId: "tab-chatgpt", platformId: "chatgpt", url: "https://chatgpt.com", title: "ChatGPT", threadId: null },
      ];

      const focusCycler = mock(async (targetId: string) => {
        cycledTabs.push(targetId);
      });

      const engine = new ComparisonEngineService(async (tab, prompt) => {
        // Simulate inference taking 120ms
        await new Promise((r) => setTimeout(r, 120));
        return {
          tab,
          threadId: "t1",
          turn: {
            id: "1",
            turnIndex: 1,
            role: "assistant" as const,
            userPrompt: prompt,
            markdownContent: `Answer from ${tab.platformId}`,
            codeBlocks: [],
            contentHash: "hash1",
            timestamp: new Date().toISOString(),
          },
          elapsedMs: 120,
          riskLabels: [],
          redactedSecretsCount: 0,
        };
      });

      const results = await engine.executeComparison({
        prompt: "Hello models",
        tabs,
        mode: "parallel",
        staggerMs: 10,
        focusCycler,
        focusCycleIntervalMs: 30, // Cycle focus every 30ms for testing
      });

      expect(results.length).toBe(2);
      expect(results[0]?.status).toBe("success");
      expect(results[1]?.status).toBe("success");
      // Focus cycler should have been triggered during parallel run
      expect(cycledTabs.length).toBeGreaterThanOrEqual(1);
      expect(cycledTabs).toContain("tab-deepseek");
    });
  });

  describe("Anti-Throttling Profile Configurations", () => {
    it("includes anti-throttling flags in Chromium default arguments", () => {
      const args = buildChromiumArgs(9222, "/tmp/test-profile");
      expect(args).toContain("--disable-background-timer-throttling");
      expect(args).toContain("--disable-backgrounding-occluded-windows");
      expect(args).toContain("--disable-renderer-backgrounding");
    });

    it("includes anti-throttling preferences in Gecko user.js", () => {
      const prefs = buildGeckoUserPrefs();
      expect(prefs).toContain('user_pref("layout.testing.top-level-always-active", true);');
      expect(prefs).toContain('user_pref("dom.min_background_timeout_value", 4);');
    });
  });
});
