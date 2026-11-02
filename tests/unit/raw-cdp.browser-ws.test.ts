import { describe, expect, it } from "bun:test";
import { BrowserWsClient } from "../../src/adapters/browsers/raw-cdp.browser-ws.js";

describe("BrowserWsClient (Modern Chromium Flattened Session Management)", () => {
  it("manages targets and flattened sessions over browser websocket", async () => {
    const sentMessages: any[] = [];
    let messageHandler: ((event: any) => void) | null = null;

    class FakeWebSocket {
      public readyState = 1; // OPEN
      public onopen: (() => void) | null = null;
      public onerror: ((e: any) => void) | null = null;
      public onclose: ((e: any) => void) | null = null;
      public onmessage: ((e: any) => void) | null = null;

      constructor(public url: string) {
        setTimeout(() => {
          this.onopen?.();
        }, 5);
      }

      send(data: string) {
        const parsed = JSON.parse(data);
        sentMessages.push(parsed);

        // Auto-reply based on method
        setTimeout(() => {
          if (!this.onmessage) return;
          if (parsed.method === "Target.getTargets") {
            this.onmessage({
              data: JSON.stringify({
                id: parsed.id,
                result: {
                  targetInfos: [
                    { targetId: "tab-1", type: "page", title: "ChatGPT", url: "https://chatgpt.com/" },
                    { targetId: "tab-2", type: "page", title: "Claude", url: "https://claude.ai/" },
                    { targetId: "bg-1", type: "service_worker", title: "Worker", url: "chrome-extension://xyz" },
                  ],
                },
              }),
            });
          } else if (parsed.method === "Target.attachToTarget") {
            this.onmessage({
              data: JSON.stringify({
                id: parsed.id,
                result: { sessionId: `session-for-${parsed.params.targetId}` },
              }),
            });
          } else if (parsed.method === "Runtime.evaluate") {
            this.onmessage({
              data: JSON.stringify({
                id: parsed.id,
                sessionId: parsed.sessionId,
                result: { result: { value: 42 } },
              }),
            });
          } else if (parsed.method === "Target.detachFromTarget") {
            this.onmessage({
              data: JSON.stringify({
                id: parsed.id,
                result: { success: true },
              }),
            });
          } else if (parsed.method === "Target.createTarget") {
            this.onmessage({
              data: JSON.stringify({
                id: parsed.id,
                result: { targetId: "tab-new-created" },
              }),
            });
          } else if (parsed.method === "Target.closeTarget") {
            this.onmessage({
              data: JSON.stringify({
                id: parsed.id,
                result: { success: true },
              }),
            });
          }
        }, 5);
      }

      close() {
        this.readyState = 3;
        this.onclose?.({ code: 1000, reason: "closed" } as any);
      }
    }

    const client = new BrowserWsClient({
      createWebSocket: (url) => new FakeWebSocket(url) as any,
    });

    await client.connect("ws://127.0.0.1:9222/devtools/browser/test-uuid");
    expect(client.isOpen()).toBe(true);

    // 1. List targets (should filter out service_worker)
    const targets = await client.getTargets();
    expect(targets.length).toBe(2);
    expect(targets[0]?.targetId).toBe("tab-1");
    expect(targets[0]?.url).toBe("https://chatgpt.com/");

    // 2. Attach to target (flattens to sessionId)
    const sessionId = await client.attachToTarget("tab-1");
    expect(sessionId).toBe("session-for-tab-1");

    // 3. Send session command
    const res = await client.sendCommand("tab-1", "Runtime.evaluate", { expression: "21 * 2" });
    expect(res?.result?.value).toBe(42);

    // Verify sent message included sessionId
    const evalMsg = sentMessages.find((m) => m.method === "Runtime.evaluate");
    expect(evalMsg?.sessionId).toBe("session-for-tab-1");

    // 4. Create target
    const newTab = await client.createTarget("https://deepseek.com/");
    expect(newTab.targetId).toBe("tab-new-created");
    expect(newTab.url).toBe("https://deepseek.com/");

    // 5. Refcounting: attach multiple times, first detach does not close session
    const s1 = await client.attachToTarget("tab-2");
    const s2 = await client.attachToTarget("tab-2");
    expect(s1).toBe(s2);
    await client.detachFromTarget("tab-2");
    // Session should still be active for tab-2
    const resTab2 = await client.sendCommand("tab-2", "Runtime.evaluate", { expression: "1+1" });
    expect(resTab2?.result?.value).toBe(42);
    // Second detach actually closes the session
    await client.detachFromTarget("tab-2");
    await expect(client.sendCommand("tab-2", "Runtime.evaluate", { expression: "1+1" })).rejects.toThrow("not attached");

    // 6. Close target
    await client.closeTarget("tab-1");
    const closeMsg = sentMessages.find((m) => m.method === "Target.closeTarget");
    expect(closeMsg?.params?.targetId).toBe("tab-1");

    client.close();
    expect(client.isOpen()).toBe(false);
  });
});
