import { describe, expect, it } from "bun:test";
import { waitForAndClickSendButton } from "../../src/adapters/platforms/driver-helpers.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import type { SessionHandle } from "../../src/core/ports/browser.port.js";

describe("Platform Driver Helpers (waitForAndClickSendButton)", () => {
  it("clicks send button and runs DOM fallback when send button is enabled", async () => {
    const browser = new FakeBrowserPort();
    const handle: SessionHandle = { sessionId: "s1", targetId: "t1", adapterId: "raw-cdp" };

    // Fake evaluation returns true for enabled button
    browser.evalResponseMap.set("send", true);

    let clicked = false;
    browser.click = async (_h, sel) => {
      if (sel === "button.send") clicked = true;
    };

    await waitForAndClickSendButton(browser, handle, "button.send", "textarea", 100);
    expect(clicked).toBe(true);
  });

  it("presses Enter key on composer when send button is not enabled", async () => {
    const browser = new FakeBrowserPort();
    const handle: SessionHandle = { sessionId: "s1", targetId: "t1", adapterId: "raw-cdp" };

    // Fake evaluation returns false for enabled button
    browser.evalResponseMap.set("send", false);

    let keyPressed = "";
    browser.pressKey = async (_h, sel, key) => {
      if (sel === "textarea") keyPressed = key;
    };

    await waitForAndClickSendButton(browser, handle, "button.send", "textarea", 50);
    expect(keyPressed).toBe("Enter");
  });
});
