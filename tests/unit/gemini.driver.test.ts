import { describe, expect, it } from "bun:test";
import { GeminiDriver } from "../../src/adapters/platforms/gemini.driver.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import type { SessionHandle } from "../../src/core/ports/browser.port.js";

describe("GeminiDriver", () => {
  const handle: SessionHandle = { sessionId: "s1", targetId: "t6", adapterId: "raw-cdp" };

  it("matches Gemini URLs and extracts thread IDs", () => {
    const driver = new GeminiDriver();
    expect(driver.matchesUrl("https://gemini.google.com/app/e2bdddb2fd90b84a")).toBe(true);
    expect(driver.matchesUrl("https://gemini.google.com/share/continue/efd6dd26976b")).toBe(true);
    expect(driver.matchesUrl("https://chatgpt.com/")).toBe(false);

    expect(driver.extractThreadId("https://gemini.google.com/app/e2bdddb2fd90b84a")).toBe("e2bdddb2fd90b84a");
    expect(driver.extractThreadId("https://gemini.google.com/share/continue/efd6dd26976b")).toBe("efd6dd26976b");
  });

  it("resolves Gemini Quill selectors and spinner indicators", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("resolveSelectors", {
      ok: true,
      layoutVariant: "gemini-modern",
      composerSelector: "rich-textarea div.ql-editor.textarea",
      sendButtonSelector: 'button[aria-label="Send message"]',
      stopIndicatorSelector: "mat-mdc-progress-spinner",
      turnContainerSelector: "user-query, model-response",
    });

    const driver = new GeminiDriver();
    const res = await driver.resolveSelectors(handle, browser);

    expect(res.ok).toBe(true);
    expect(res.layoutVariant).toBe("gemini-modern");
    expect(res.composerSelector).toBe("rich-textarea div.ql-editor.textarea");
    expect(res.stopIndicatorSelector).toBe("mat-mdc-progress-spinner");
  });

  it("reads thread turns from user-query and model-response nodes", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("readThread", {
      layoutVariant: "gemini-modern",
      turns: [
        {
          turnIndex: 0,
          role: "user",
          markdownContent: "What is the capital of France?",
          codeBlocks: [],
          contentHash: "hash-u1",
        },
        {
          turnIndex: 1,
          role: "assistant",
          markdownContent: "The capital of France is Paris.",
          codeBlocks: [],
          contentHash: "hash-a1",
        },
      ],
    });

    const driver = new GeminiDriver();
    const thread = await driver.readThread(handle, browser);

    expect(thread.turns.length).toBe(2);
    expect(thread.turns[0]?.role).toBe("user");
    expect(thread.turns[1]?.markdownContent).toBe("The capital of France is Paris.");
  });

  it("submits prompt targeting Quill editor and dynamic send button", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("submitPrompt", {
      turnCount: 2,
      lastTurnHash: "2",
      submittedPromptHash: "20",
    });

    const driver = new GeminiDriver();
    const fp = await driver.submitPrompt(handle, browser, "Hello Gemini from test");

    expect(fp.turnCount).toBe(2);
    expect(browser.evaluatedExpressions.length).toBe(1);
    expect(browser.evaluatedExpressions[0]).toContain("Hello Gemini from test");
  });

  it("awaits completion detecting spinner absence and stable output", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("awaitCompletion", {
      turnsCount: 4,
      hasNewTurn: true,
      isGenerating: false,
      assistantText: "Here is the response",
      codeBlocks: [{ language: "ts", code: "const x = 1;" }],
    });

    const driver = new GeminiDriver();
    const before = { turnCount: 2, lastTurnHash: "2", submittedPromptHash: "20" };
    const result = await driver.awaitCompletion(handle, browser, before, 2000);

    expect(result.status).toBe("complete");
    expect(result.turn.markdownContent).toBe("Here is the response");
    expect(result.turn.codeBlocks.length).toBe(1);
    expect(result.turn.codeBlocks[0]?.language).toBe("ts");
  });

  it("detects sandbox download links in Gemini turns", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("findDownloadLinks", [
      { url: "https://gemini.google.com/download/file-1", filename: "data.csv", label: "Download CSV" },
    ]);

    const driver = new GeminiDriver();
    const links = await driver.findDownloadLinks(handle, browser);

    expect(links.length).toBe(1);
    expect(links[0]?.filename).toBe("data.csv");
  });

  it("detects and triggers continuation button in Gemini", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("findContinuationTrigger", {
      hasContinuation: true,
      triggerSelector: 'button[aria-label*="Continue"]',
    });

    const driver = new GeminiDriver();
    const trigger = await driver.findContinuationTrigger(handle, browser);

    expect(trigger.hasContinuation).toBe(true);
    await driver.triggerContinuation(handle, browser);
    expect(browser.clickedSelectors.length).toBe(1);
  });

  it("provides base URL and triggers new chat", async () => {
    const browser = new FakeBrowserPort();
    const driver = new GeminiDriver();

    expect(driver.getBaseUrl()).toBe("https://gemini.google.com/app");

    await driver.startNewChat(handle, browser);
    expect(browser.evaluatedExpressions.some((e) => e.includes("startNewChat"))).toBe(true);
  });
});
