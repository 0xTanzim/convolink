import { describe, expect, it } from "bun:test";
import { ClaudeDriver } from "../../src/adapters/platforms/claude.driver.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import type { SessionHandle } from "../../src/core/ports/browser.port.js";

describe("ClaudeDriver", () => {
  const handle: SessionHandle = { sessionId: "s1", targetId: "t-claude", adapterId: "raw-cdp" };

  it("matches Claude URLs and extracts thread IDs", () => {
    const driver = new ClaudeDriver();
    expect(driver.matchesUrl("https://claude.ai/chat/5b736b8e-3e1a-4c28-98e3-0d319e7a8e21")).toBe(true);
    expect(driver.matchesUrl("https://claude.ai/new")).toBe(true);
    expect(driver.matchesUrl("https://chatgpt.com/")).toBe(false);

    expect(driver.extractThreadId("https://claude.ai/chat/5b736b8e-3e1a-4c28-98e3-0d319e7a8e21")).toBe(
      "5b736b8e-3e1a-4c28-98e3-0d319e7a8e21",
    );
    expect(driver.extractThreadId("https://claude.ai/new")).toBe("");
  });

  it("resolves Claude ProseMirror selectors", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("resolveSelectors", {
      ok: true,
      layoutVariant: "claude-prosemirror-v1",
      composerSelector: "div.ProseMirror[contenteditable='true']",
      sendButtonSelector: 'button[aria-label="Send Message"]',
      stopIndicatorSelector: 'button[aria-label*="Stop"]',
      turnContainerSelector: "div[data-test-render-count]",
    });

    const driver = new ClaudeDriver();
    const res = await driver.resolveSelectors(handle, browser);

    expect(res.ok).toBe(true);
    expect(res.layoutVariant).toBe("claude-prosemirror-v1");
    expect(res.composerSelector).toBe("div.ProseMirror[contenteditable='true']");
  });

  it("reads thread turns and parses code blocks", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("readThread", {
      layoutVariant: "claude-prosemirror-v1",
      turns: [
        {
          turnIndex: 0,
          role: "user",
          markdownContent: "Write an add function",
          codeBlocks: [],
          contentHash: "hash-1",
        },
        {
          turnIndex: 1,
          role: "assistant",
          markdownContent: "Here is the code:\n```typescript\nexport const add = (a: number, b: number) => a + b;\n```",
          codeBlocks: [{ language: "typescript", code: "export const add = (a: number, b: number) => a + b;" }],
          contentHash: "hash-2",
        },
      ],
    });

    const driver = new ClaudeDriver();
    const thread = await driver.readThread(handle, browser);

    expect(thread.turns.length).toBe(2);
    expect(thread.turns[1]?.role).toBe("assistant");
    expect(thread.turns[1]?.codeBlocks.length).toBe(1);
    expect(thread.turns[1]?.codeBlocks[0]?.language).toBe("typescript");
  });

  it("submits prompt targeting ProseMirror editor and send button", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("/* submitPrompt */", {
      turnCount: 2,
      lastTurnHash: "prior-content",
      submittedPromptHash: "15",
    });

    const driver = new ClaudeDriver();
    const fingerprint = await driver.submitPrompt(handle, browser, "Hello Claude 3.7");

    expect(fingerprint.turnCount).toBe(2);
    expect(fingerprint.submittedPromptHash).toBe("15");
    expect(browser.filledTexts.some((f) => f.text === "Hello Claude 3.7")).toBe(true);
  });

  it("awaits completion detecting stream settling and absence of stop button", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("awaitCompletion", {
      turnsCount: 2,
      hasNewTurn: true,
      isGenerating: false,
      assistantText: "Here is your solution.",
      codeBlocks: [],
    });

    const driver = new ClaudeDriver();
    const result = await driver.awaitCompletion(
      handle,
      browser,
      { turnCount: 1, lastTurnHash: "" },
      5000,
    );

    expect(result.status).toBe("complete");
    expect(result.turn.role).toBe("assistant");
    expect(result.turn.markdownContent).toBe("Here is your solution.");
  });

  it("provides base URL and triggers new chat", async () => {
    const browser = new FakeBrowserPort();
    const driver = new ClaudeDriver();

    expect(driver.getBaseUrl()).toBe("https://claude.ai/new");
    await driver.startNewChat(handle, browser);
    expect(browser.evaluatedExpressions.length).toBeGreaterThan(0);
  });
});
