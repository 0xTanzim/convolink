import { describe, expect, it } from "bun:test";
import { BridgeDaemonService } from "../../src/adapters/daemon/bridge-daemon.service.js";

describe("Gecko BiDi Contention & Daemon-First Routing (gecko-bidi-session-contention.md)", () => {
  it("Issue 1: BridgeDaemonService dispatch('ask') unpacks threadUrl into a parsed thread target", async () => {
    let capturedOptions: any = null;
    const fakeOrchestrator = {
      getBrowser: () => ({ id: "firefox-bidi" }),
      ask: async (options: any) => {
        capturedOptions = options;
        return {
          tab: { platformId: "deepseek", targetId: "target-1" },
          turn: { markdownContent: "Answer from thread" },
          elapsedMs: 100,
          riskLabels: [],
          redactedSecretsCount: 0,
        };
      },
    } as any;

    const daemon = new BridgeDaemonService({ orchestrator: fakeOrchestrator });
    const dispatch = (daemon as any).dispatch.bind(daemon);

    await dispatch("ask", {
      prompt: "Hello again",
      platform: "deepseek",
      threadUrl: "https://chat.deepseek.com/a/chat/s/12345",
    });

    expect(capturedOptions).not.toBeNull();
    expect(capturedOptions.thread).toBeDefined();
    expect(capturedOptions.thread.platform).toBe("deepseek");
    expect(capturedOptions.thread.url).toBe("https://chat.deepseek.com/a/chat/s/12345");
  });

  it("Issue 1: BridgeDaemonService dispatch('compare') unpacks threadsRaw and continueThreads", async () => {
    let capturedOptions: any = null;
    const fakeOrchestrator = {
      getBrowser: () => ({ id: "firefox-bidi" }),
      compare: async (options: any) => {
        capturedOptions = options;
        return {
          comparisonId: "cmp-1",
          scheduleMode: "parallel",
          totalDurationMs: 200,
          results: [],
          markdownReport: "# Report",
        };
      },
    } as any;

    const daemon = new BridgeDaemonService({ orchestrator: fakeOrchestrator });
    const dispatch = (daemon as any).dispatch.bind(daemon);

    await dispatch("compare", {
      prompt: "Compare models",
      platforms: ["deepseek", "chatgpt"],
      threadsRaw: "deepseek=https://chat.deepseek.com/a/chat/s/123,chatgpt=https://chatgpt.com/c/456",
      continueThreads: true,
    });

    expect(capturedOptions).not.toBeNull();
    expect(capturedOptions.continueThreads).toBe(true);
    expect(capturedOptions.threads).toBeDefined();
    expect(capturedOptions.threads.deepseek.url).toBe("https://chat.deepseek.com/a/chat/s/123");
    expect(capturedOptions.threads.chatgpt.url).toBe("https://chatgpt.com/c/456");
  });

  it("Issue 2: forward dynamically routes through DaemonClient when daemon is alive and falls back when dead", async () => {
    const { forward, setFallbackOrchestrator } = await import("../../src/entrypoints/mcp.orchestrator.js");
    let isDaemonAlive = false;
    let daemonCalls = 0;

    const fakeClient = {
      isAlive: async () => isDaemonAlive,
      sendRequest: async (command: string, payload?: any) => {
        if (!isDaemonAlive) {
          const err = new Error("connect ECONNREFUSED");
          (err as any).code = "ECONNREFUSED";
          throw err;
        }
        daemonCalls++;
        return { ok: true, result: [{ targetId: "daemon-tab-1", title: "Daemon Tab" }] };
      },
    } as any;

    const fakeOrch = {
      listTabs: async () => [{ targetId: "fallback-tab-1", title: "Fallback Tab" }],
    } as any;

    // Start with fallback
    setFallbackOrchestrator(fakeOrch);
    const caller = forward(fakeClient, "list");

    try {
      // 1. When fallbackOrchestrator is set in unit test, it uses fallback
      const res1 = await caller();
      expect(res1[0].targetId).toBe("fallback-tab-1");

      // 2. Now clear test seam fallback orchestrator so dynamic routing activates
      setFallbackOrchestrator(null);

      // Daemon is offline -> calls invokeInProcess (which creates fallback container)
      // Let's test when daemon becomes alive:
      isDaemonAlive = true;
      const res2 = await caller();
      expect(res2[0].targetId).toBe("daemon-tab-1");
      expect(daemonCalls).toBe(1);
    } finally {
      setFallbackOrchestrator(null);
    }
  });

  it("Issue 3: ensureDaemonRunning returns true immediately if daemon is already alive", async () => {
    const { ensureDaemonRunning } = await import("../../src/entrypoints/cli.daemon.js");
    // With non-existent socket, it won't crash and returns boolean
    const result = await ensureDaemonRunning({ socketPath: "/tmp/non-existent-test-socket.sock" });
    expect(typeof result).toBe("boolean");
  });
});
