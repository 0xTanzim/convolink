import { describe, expect, it } from "bun:test";
import { TabManagerService } from "../../src/core/services/tab-manager.service.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";

describe("tab creation readiness", () => {
  it("returns only after the new tab reported a ready composer", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("resolveSelectors", {
      ok: true,
      layoutVariant: "v1",
      composerSelector: "textarea#chat-input",
      sendButtonSelector: "button.send",
      stopIndicatorSelector: null,
      turnContainerSelector: ".turn",
    });

    const expressions: string[] = [];
    browser.evaluate = async (_handle, expression) => {
      expressions.push(expression);
      if (expression.includes("resolveSelectors")) {
        return {
          ok: true,
          layoutVariant: "v1",
          composerSelector: "textarea#chat-input",
          sendButtonSelector: "button.send",
          stopIndicatorSelector: null,
          turnContainerSelector: ".turn",
        } as never;
      }
      return true as never;
    };

    const manager = new TabManagerService(browser, [new DeepSeekDriver()], new LockService(), undefined, {
      readinessTimeoutMs: 20_000,
    });
    const tab = await manager.createTab("deepseek");

    expect(tab.targetId).toBe("tab-spawned-1");
    expect(expressions.some((expr) => expr.includes("document.readyState"))).toBe(true);
  });

  it("does not wait for a send button that only appears after typing", async () => {
    const browser = new FakeBrowserPort();
    const expressions: string[] = [];
    browser.evaluate = async (_handle, expression) => {
      expressions.push(expression);
      if (expression.includes("resolveSelectors")) {
        return { ok: true, composerSelector: "rich-textarea .ql-editor", sendButtonSelector: null } as never;
      }
      return true as never;
    };

    const manager = new TabManagerService(browser, [new DeepSeekDriver()], new LockService(), undefined, {
      readinessTimeoutMs: 5_000,
    });
    const startedAt = Date.now();
    await manager.createTab("deepseek");

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(expressions.some((expr) => expr.includes("document.readyState"))).toBe(true);
  });

  it("does not block forever when the layout never resolves", async () => {
    const browser = new FakeBrowserPort();
    browser.evaluate = async () => ({ ok: false }) as never;

    const manager = new TabManagerService(browser, [new DeepSeekDriver()], new LockService(), undefined, {
      readinessTimeoutMs: 300,
    });

    const startedAt = Date.now();
    const tab = await manager.createTab("deepseek");

    expect(tab.targetId).toBe("tab-spawned-1");
    expect(Date.now() - startedAt).toBeLessThan(3000);
  });
});
