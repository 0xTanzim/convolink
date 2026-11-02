import { describe, expect, it } from "bun:test";
import { FirefoxBidiAdapter, deserializeBidiRemoteValue } from "../../src/adapters/browsers/firefox-bidi.adapter.js";
import type { SessionHandle } from "../../src/core/ports/browser.port.js";

describe("FirefoxBidiAdapter", () => {
  describe("deserializeBidiRemoteValue", () => {
    it("deserializes primitive BiDi types", () => {
      expect(deserializeBidiRemoteValue({ type: "string", value: "convolink" })).toBe("convolink");
      expect(deserializeBidiRemoteValue({ type: "number", value: 42 })).toBe(42);
      expect(deserializeBidiRemoteValue({ type: "boolean", value: true })).toBe(true);
      expect(deserializeBidiRemoteValue({ type: "null" })).toBeNull();
      expect(deserializeBidiRemoteValue({ type: "undefined" })).toBeUndefined();
    });

    it("deserializes complex BiDi objects and arrays", () => {
      const bidiArray = {
        type: "array",
        value: [
          { type: "string", value: "first" },
          { type: "number", value: 100 },
        ],
      };
      expect(deserializeBidiRemoteValue(bidiArray)).toEqual(["first", 100]);

      const bidiObject = {
        type: "object",
        value: [
          ["ok", { type: "boolean", value: true }],
          ["turnsCount", { type: "number", value: 5 }],
          ["nested", { type: "object", value: [["sub", { type: "string", value: "val" }]] }],
        ],
      };
      expect(deserializeBidiRemoteValue(bidiObject)).toEqual({
        ok: true,
        turnsCount: 5,
        nested: { sub: "val" },
      });
    });
  });

  describe("Adapter Operations via Mock WebSocket Messenger", () => {
    it("reports id and capabilities accurately for Firefox BiDi", () => {
      const adapter = new FirefoxBidiAdapter();
      expect(adapter.id).toBe("firefox-bidi");
      expect(adapter.capabilities.protocol).toBe("webdriver-bidi");
      expect(adapter.capabilities.browserFamily).toBe("firefox");
      expect(adapter.capabilities.supportsTabManagement).toBe(true);
    });

    it("defaults to port 9223 for WebDriver BiDi", async () => {
      const adapter = new FirefoxBidiAdapter(undefined, async () => ({ contexts: [] }));
      const health = await adapter.health();
      expect(health.endpoint).toContain(":9223");
    });

    it("lists open tabs using browsingContext.getTree", async () => {
      const sentMessages: any[] = [];
      const adapter = new FirefoxBidiAdapter(9222, async (method, params) => {
        sentMessages.push({ method, params });
        if (method === "browsingContext.getTree") {
          return {
            contexts: [
              { context: "ctx-1", url: "https://chatgpt.com/c/123", children: [] },
              { context: "ctx-2", url: "https://chat.deepseek.com", children: [] },
            ],
          };
        }
        return {};
      });

      const tabs = await adapter.listTabs();
      expect(tabs.length).toBe(2);
      expect(tabs[0]?.targetId).toBe("ctx-1");
      expect(tabs[0]?.url).toBe("https://chatgpt.com/c/123");
      expect(tabs[1]?.targetId).toBe("ctx-2");
      expect(sentMessages[0]?.method).toBe("browsingContext.getTree");
    });

    it("extracts document.title for discovered tabs when available", async () => {
      const adapter = new FirefoxBidiAdapter(9222, async (method, _params) => {
        if (method === "browsingContext.getTree") {
          return { contexts: [{ context: "ctx-1", url: "https://chatgpt.com/c/123", children: [] }] };
        }
        if (method === "script.evaluate") {
          return { type: "success", result: { type: "string", value: "ChatGPT — Advanced Refactoring" } };
        }
        return {};
      });

      const tabs = await adapter.listTabs();
      expect(tabs.length).toBe(1);
      expect(tabs[0]?.title).toBe("ChatGPT — Advanced Refactoring");
    });

    it("evaluates JavaScript expressions using script.evaluate with deserialization", async () => {
      const adapter = new FirefoxBidiAdapter(9222, async (method, params) => {
        if (method === "script.evaluate") {
          return {
            type: "success",
            result: {
              type: "object",
              value: [
                ["status", { type: "string", value: "complete" }],
                ["turnsCount", { type: "number", value: 3 }],
              ],
            },
          };
        }
        return {};
      });

      const handle: SessionHandle = {
        sessionId: "s1",
        targetId: "ctx-1",
        adapterId: "firefox-bidi",
      };

      const result = await adapter.evaluate<{ status: string; turnsCount: number }>(
        handle,
        "(() => ({ status: 'complete', turnsCount: 3 }))()",
      );

      expect(result.status).toBe("complete");
      expect(result.turnsCount).toBe(3);
    });

    it("creates a new tab via browsingContext.create and navigates", async () => {
      const sent: any[] = [];
      const adapter = new FirefoxBidiAdapter(9222, async (method, params) => {
        sent.push({ method, params });
        if (method === "browsingContext.create") {
          return { context: "ctx-new-tab" };
        }
        return {};
      });

      const tab = await adapter.createTab("https://chat.deepseek.com");
      expect(tab.targetId).toBe("ctx-new-tab");
      expect(tab.url).toBe("https://chat.deepseek.com");

      expect(sent[0]?.method).toBe("browsingContext.create");
      expect(sent[1]?.method).toBe("browsingContext.navigate");
      expect(sent[1]?.params.url).toBe("https://chat.deepseek.com");
    });

    it("closes a tab via browsingContext.close", async () => {
      const sent: any[] = [];
      const adapter = new FirefoxBidiAdapter(9222, async (method, params) => {
        sent.push({ method, params });
        return {};
      });

      await adapter.closeTab("ctx-to-close");
      expect(sent[0]?.method).toBe("browsingContext.close");
      expect(sent[0]?.params.context).toBe("ctx-to-close");
    });

    it("sends session.end when disconnect() is called", async () => {
      const sent: any[] = [];
      const adapter = new FirefoxBidiAdapter(9223, async (method, params) => {
        sent.push({ method, params });
        return {};
      });

      await adapter.disconnect();
      expect(sent[0]?.method).toBe("session.end");
    });

    it("uses native input.performActions with pointer coordinates on click()", async () => {
      const sent: any[] = [];
      const adapter = new FirefoxBidiAdapter(9223, async (method, params) => {
        sent.push({ method, params });
        if (method === "script.evaluate") {
          return { type: "success", result: { type: "object", value: [["x", { type: "number", value: 150 }], ["y", { type: "number", value: 250 }]] } };
        }
        return {};
      });

      await adapter.click({ sessionId: "s1", targetId: "ctx-1", adapterId: "firefox-bidi" }, "#send-btn");
      const actionCall = sent.find((s) => s.method === "input.performActions");
      expect(actionCall).toBeDefined();
      expect(actionCall.params.actions[0].type).toBe("pointer");
    });

    it("uses native input.performActions on pressKey()", async () => {
      const sent: any[] = [];
      const adapter = new FirefoxBidiAdapter(9223, async (method, params) => {
        sent.push({ method, params });
        return {};
      });

      await adapter.pressKey({ sessionId: "s1", targetId: "ctx-1", adapterId: "firefox-bidi" }, "#input", "Enter");
      const actionCall = sent.find((s) => s.method === "input.performActions");
      expect(actionCall).toBeDefined();
      expect(actionCall.params.actions[0].type).toBe("key");
    });

    it("keeps session active during detach() until disconnect()", async () => {
      const sent: any[] = [];
      const adapter = new FirefoxBidiAdapter(9223, async (method, params) => {
        sent.push({ method, params });
        return {};
      });

      await adapter.detach({ sessionId: "test-sess", targetId: "ctx-1", adapterId: "firefox-bidi" });
      expect(sent.length).toBe(0);

      await adapter.disconnect();
      expect(sent[0]?.method).toBe("session.end");
    });
  });
});
