import { describe, expect, it } from "bun:test";
import { waitForAndClickSendButton } from "../../src/adapters/platforms/driver-helpers.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import type { SessionHandle } from "../../src/core/ports/browser.port.js";

const handle: SessionHandle = { sessionId: "s1", targetId: "t1", adapterId: "raw-cdp" };

function activations(browser: FakeBrowserPort): number {
  return browser.evaluatedExpressions.filter((expr) => expr.includes("send.click()")).length;
}

describe("waitForAndClickSendButton", () => {
  it("activates send exactly once when the button is enabled", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("ds-button--disabled", true);
    browser.evalResponseMap.set("innerText", false);

    await waitForAndClickSendButton(browser, handle, "button.send", "textarea", 2000);

    expect(activations(browser)).toBe(1);
    expect(browser.clickedSelectors).toEqual([]);
  });

  it("never dispatches a second synthetic click event", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("ds-button--disabled", true);
    browser.evalResponseMap.set("innerText", false);

    await waitForAndClickSendButton(browser, handle, "button.send", "textarea", 2000);

    const dispatchCalls = browser.evaluatedExpressions.filter((expr) => expr.includes("dispatchEvent"));
    expect(dispatchCalls).toEqual([]);
  });

  it("presses Enter once when the composer still holds the text", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("ds-button--disabled", true);
    browser.evalResponseMap.set("innerText", true);

    const keys: string[] = [];
    browser.pressKey = async (_h, selector, key) => {
      keys.push(`${selector}:${key}`);
      browser.evalResponseMap.set("innerText", false);
    };

    await waitForAndClickSendButton(browser, handle, "button.send", "textarea", 2000);

    expect(keys).toEqual(["textarea:Enter"]);
  });

  it("does not press Enter when the composer cleared after the click", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("ds-button--disabled", true);
    browser.evalResponseMap.set("innerText", false);

    const keys: string[] = [];
    browser.pressKey = async (_h, _selector, key) => {
      keys.push(key);
    };

    await waitForAndClickSendButton(browser, handle, "button.send", "textarea", 2000);

    expect(keys).toEqual([]);
  });

  it("sends nothing while the page is not ready", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("ds-button--disabled", false);
    browser.evalResponseMap.set("innerText", true);

    const keys: string[] = [];
    browser.pressKey = async (_h, _selector, key) => {
      keys.push(key);
    };

    await expect(waitForAndClickSendButton(browser, handle, "button.send", "textarea", 300))
      .rejects.toMatchObject({ code: "not-ready" });

    expect(activations(browser)).toBe(0);
    expect(keys).toEqual([]);
  });

  it("fails loudly when the prompt never leaves the composer", async () => {
    const browser = new FakeBrowserPort();
    browser.evalResponseMap.set("ds-button--disabled", true);
    browser.evalResponseMap.set("innerText", true);

    await expect(
      waitForAndClickSendButton(browser, handle, "button.send", "textarea", 2000),
    ).rejects.toThrow(/submission was not observed/i);
  });
});
