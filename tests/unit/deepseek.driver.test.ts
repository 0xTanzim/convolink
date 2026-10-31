import { describe, expect, it } from "bun:test";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import type { SessionHandle } from "../../src/core/ports/browser.port.js";

describe("DeepSeekDriver", () => {
  const handle: SessionHandle = { sessionId: "s1", targetId: "t4", adapterId: "raw-cdp" };

  it("matches DeepSeek URLs and extracts thread IDs", () => {
    const driver = new DeepSeekDriver();
    expect(driver.matchesUrl("https://chat.deepseek.com/a/chat/s/b36a98cc-7205-4cde-a1a0-cfc6c98f35c8")).toBe(true);
    expect(driver.matchesUrl("https://chatgpt.com/c/123")).toBe(false);
    expect(driver.extractThreadId("https://chat.deepseek.com/a/chat/s/b36a98cc-7205-4cde-a1a0-cfc6c98f35c8")).toBe(
      "b36a98cc-7205-4cde-a1a0-cfc6c98f35c8",
    );
  });

  it("resolves selectors testing DOM presence", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("resolveSelectors", {
      ok: true,
      layoutVariant: "deepseek-standard-v1",
      composerSelector: "textarea",
      sendButtonSelector: 'div[role="button"].ds-button--circle',
      stopIndicatorSelector: "svg linearGradient",
      turnContainerSelector: ".ds-markdown",
    });

    const driver = new DeepSeekDriver();
    const res = await driver.resolveSelectors(handle, browser);

    expect(res.ok).toBe(true);
    expect(res.layoutVariant).toBe("deepseek-standard-v1");
    expect(res.composerSelector).toBe("textarea");
  });

  it("reads thread turns and extracts code blocks with textContent", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("readThread", {
      layoutVariant: "deepseek-standard-v1",
      turns: [
        {
          turnIndex: 0,
          role: "user",
          markdownContent: "Write hello world in TS",
          codeBlocks: [],
          contentHash: "hash1",
        },
        {
          turnIndex: 1,
          role: "assistant",
          markdownContent: "Here is your code:\n\n```typescript\nconsole.log('hello');\n```",
          codeBlocks: [{ language: "typescript", code: "console.log('hello');" }],
          contentHash: "hash2",
        },
      ],
    });

    const driver = new DeepSeekDriver();
    const thread = await driver.readThread(handle, browser);

    expect(thread.turns.length).toBe(2);
    expect(thread.turns[1]?.role).toBe("assistant");
    expect(thread.turns[1]?.codeBlocks[0]?.code).toBe("console.log('hello');");
  });

  it("submits prompt using prototype setter injection", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("submitPrompt", {
      turnCount: 2,
      lastTurnHash: "hash-last",
      submittedPromptHash: "hash-prompt",
    });

    const driver = new DeepSeekDriver();
    const fingerprint = await driver.submitPrompt(handle, browser, "Hello DeepSeek");

    expect(fingerprint.turnCount).toBe(2);
    expect(browser.evaluatedExpressions.some((e) => e.includes("HTMLTextAreaElement.prototype"))).toBe(true);
  });

  it("detects download links and continuation in DeepSeek", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("findDownloadLinks", [
      { url: "blob:https://chat.deepseek.com/123", filename: "export.json" },
    ]);
    browser.evalResponseMap.set("findContinuationTrigger", {
      hasContinuation: true,
      triggerSelector: "button.ds-button--continue",
    });

    const driver = new DeepSeekDriver();
    const links = await driver.findDownloadLinks(handle, browser);
    expect(links.length).toBe(1);

    const trigger = await driver.findContinuationTrigger(handle, browser);
    expect(trigger.hasContinuation).toBe(true);
    await driver.triggerContinuation(handle, browser);
    expect(browser.clickedSelectors.length).toBe(1);
  });

  it("provides base URL and triggers new chat", async () => {
    const browser = new FakeBrowserPort();
    const driver = new DeepSeekDriver();

    expect(driver.getBaseUrl()).toBe("https://chat.deepseek.com/");

    await driver.startNewChat(handle, browser);
    expect(browser.evaluatedExpressions.some((e) => e.includes("startNewChat"))).toBe(true);
  });
});
