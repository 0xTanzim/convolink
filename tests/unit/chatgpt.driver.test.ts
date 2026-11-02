import { describe, expect, it } from "bun:test";
import { ChatGPTDriver } from "../../src/adapters/platforms/chatgpt.driver.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import type { SessionHandle } from "../../src/core/ports/browser.port.js";

describe("ChatGPTDriver", () => {
  const handle: SessionHandle = { sessionId: "s1", targetId: "t5", adapterId: "raw-cdp" };

  it("matches ChatGPT URLs and extracts thread IDs", () => {
    const driver = new ChatGPTDriver();
    expect(driver.matchesUrl("https://chatgpt.com/c/6ae56dbc-63fc-83ec-bc20-00b69ce6cc33")).toBe(true);
    expect(driver.matchesUrl("https://chat.openai.com/c/abc-123")).toBe(true);
    expect(driver.matchesUrl("https://chat.deepseek.com/")).toBe(false);

    expect(driver.extractThreadId("https://chatgpt.com/c/6ae56dbc-63fc-83ec-bc20-00b69ce6cc33")).toBe(
      "6ae56dbc-63fc-83ec-bc20-00b69ce6cc33",
    );
  });

  it("resolves modern 2026 ProseMirror selectors", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("resolveSelectors", {
      ok: true,
      layoutVariant: "chatgpt-2026-turnkey",
      composerSelector: "div.ProseMirror[contenteditable='true']",
      sendButtonSelector: 'button[aria-label="Send"]',
      stopIndicatorSelector: 'button[aria-label*="Stop"]',
      turnContainerSelector: "[data-turn-key]",
    });

    const driver = new ChatGPTDriver();
    const res = await driver.resolveSelectors(handle, browser);

    expect(res.ok).toBe(true);
    expect(res.layoutVariant).toBe("chatgpt-2026-turnkey");
    expect(res.composerSelector).toBe("div.ProseMirror[contenteditable='true']");
  });

  it("reads virtualized turn-key turns and parses assistant text", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("readThread", {
      layoutVariant: "chatgpt-2026-turnkey",
      turns: [
        {
          turnIndex: 0,
          role: "user",
          markdownContent: "hi",
          codeBlocks: [],
          contentHash: "hash-u1",
        },
        {
          turnIndex: 1,
          role: "assistant",
          markdownContent: "Hey! Welcome back! 😊",
          codeBlocks: [],
          contentHash: "hash-a1",
        },
      ],
    });

    const driver = new ChatGPTDriver();
    const thread = await driver.readThread(handle, browser);

    expect(thread.turns.length).toBe(2);
    expect(thread.turns[0]?.role).toBe("user");
    expect(thread.turns[1]?.markdownContent).toBe("Hey! Welcome back! 😊");
  });

  it("submits prompt targeting ProseMirror editor and dynamic send button", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("/* submitPrompt */", {
      turnCount: 2,
      lastTurnHash: "turn-hash-2",
      submittedPromptHash: "prompt-hash",
    });

    const driver = new ChatGPTDriver();
    const fingerprint = await driver.submitPrompt(handle, browser, "Hello ChatGPT");

    expect(fingerprint.turnCount).toBe(2);
    expect(browser.filledTexts.some((f) => f.text === "Hello ChatGPT")).toBe(true);
  });

  it("throws AuthChallengeError login_required immediately when login wall is detected on submitPrompt", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("/* authCheck */", true);

    const driver = new ChatGPTDriver();
    expect(driver.submitPrompt(handle, browser, "Hello ChatGPT")).rejects.toThrow("login_required");
  });

  it("throws AuthChallengeError turnstile when Cloudflare challenge is detected", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("challenges.cloudflare.com", {
      detected: true,
      isInteractive: true,
      rect: { left: 100, top: 200, width: 300, height: 65 },
    });

    const driver = new ChatGPTDriver();
    expect(driver.submitPrompt(handle, browser, "Hello ChatGPT")).rejects.toThrow("turnstile");
  });

  it("inspects Canvas editor when active in ChatGPT", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("inspectCanvas", {
      title: "Document.md",
      content: "# Live Canvas Doc\nContent inside canvas",
      language: "markdown",
    });

    const driver = new ChatGPTDriver();
    const doc = await driver.inspectCanvas(handle, browser);

    expect(doc).not.toBeNull();
    expect(doc?.title).toBe("Document.md");
    expect(doc?.content).toContain("# Live Canvas Doc");
  });

  it("detects and triggers continuation button when stream is truncated", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("findContinuationTrigger", {
      hasContinuation: true,
      triggerSelector: 'button[aria-label*="Continue generating"]',
    });

    const driver = new ChatGPTDriver();
    const trigger = await driver.findContinuationTrigger(handle, browser);

    expect(trigger.hasContinuation).toBe(true);

    await driver.triggerContinuation(handle, browser);
    expect(browser.clickedSelectors).toContain('button[aria-label*="Continue generating"], button.continue-btn');
  });

  it("provides base URL and triggers new chat", async () => {
    const browser = new FakeBrowserPort();
    const driver = new ChatGPTDriver();

    expect(driver.getBaseUrl()).toBe("https://chatgpt.com/");

    await driver.startNewChat(handle, browser);
    expect(browser.evaluatedExpressions.some((e) => e.includes("startNewChat"))).toBe(true);
  });
});
