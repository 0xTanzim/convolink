import { describe, expect, it } from "bun:test";
import { ChatGPTDriver } from "../../src/adapters/platforms/chatgpt.driver.js";
import { ClaudeDriver } from "../../src/adapters/platforms/claude.driver.js";
import { GeminiDriver } from "../../src/adapters/platforms/gemini.driver.js";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";
import type { SessionHandle } from "../../src/core/ports/browser.port.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";

describe("Platform Drivers Native Input Delegation (platform-drivers-humanized)", () => {
  const handle: SessionHandle = { sessionId: "s1", targetId: "tab-1", adapterId: "raw-cdp" };

  it("ChatGPTDriver delegates to browser.fillText and browser.click/pressKey", async () => {
    const driver = new ChatGPTDriver();
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("/* submitPrompt */", {
      turnCount: 2,
      lastTurnHash: "turn-2",
      submittedPromptHash: "0",
    });

    await driver.submitPrompt(handle, browser, "Hello ChatGPT");

    expect(browser.filledTexts.some((f) => f.text === "Hello ChatGPT")).toBe(true);
  });

  it("ClaudeDriver delegates to browser.fillText and browser.click/pressKey", async () => {
    const driver = new ClaudeDriver();
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("/* submitPrompt */", {
      turnCount: 2,
      lastTurnHash: "turn-2",
      submittedPromptHash: "0",
    });

    await driver.submitPrompt(handle, browser, "Hello Claude");

    expect(browser.filledTexts.some((f) => f.text === "Hello Claude")).toBe(true);
  });

  it("GeminiDriver delegates to browser.fillText and browser.click/pressKey", async () => {
    const driver = new GeminiDriver();
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("/* submitPrompt */", {
      turnCount: 2,
      lastTurnHash: "turn-2",
      submittedPromptHash: "0",
    });

    await driver.submitPrompt(handle, browser, "Hello Gemini");

    expect(browser.filledTexts.some((f) => f.text === "Hello Gemini")).toBe(true);
  });

  it("DeepSeekDriver delegates to browser.fillText and browser.click/pressKey", async () => {
    const driver = new DeepSeekDriver();
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("/* submitPrompt */", {
      turnCount: 2,
      lastTurnHash: "turn-2",
      submittedPromptHash: "0",
    });

    await driver.submitPrompt(handle, browser, "Hello DeepSeek");

    expect(browser.filledTexts.some((f) => f.text === "Hello DeepSeek")).toBe(true);
  });
});
