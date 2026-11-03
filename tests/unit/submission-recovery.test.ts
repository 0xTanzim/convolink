import { describe, expect, it } from "bun:test";
import { submitWithRecovery } from "../../src/adapters/platforms/driver-helpers.js";
import type { BrowserPort, SessionHandle, TabDescriptor, TransportHealth } from "../../src/core/ports/browser.port.js";
import { recordManagedTab } from "../../src/adapters/browsers/tab-registry.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
process.env.XDG_RUNTIME_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "convo-runtime-"));

class ScriptedBrowser implements BrowserPort {
  public readonly id = "firefox-bidi" as const;
  public textInComposer = true;
  public sendEnabled = false;
  public promptInBody = false;
  public reloads = 0;
  public clicks = 0;
  public remounted = false;

  async health(): Promise<TransportHealth> {
    return { ok: true, adapterId: this.id, endpoint: "x", openTabsCount: 0, latencyMs: 0 };
  }
  async listTabs(): Promise<TabDescriptor[]> { return []; }
  async attach(targetId: string): Promise<SessionHandle> { return { sessionId: "s", targetId, adapterId: this.id }; }
  async detach(): Promise<void> {}
  async keepAliveInBackground(): Promise<void> {}
  async bringToFront(): Promise<void> {}
  async fillText(_h: SessionHandle, _s: string, _t: string): Promise<void> { this.textInComposer = true; }
  async pressKey(): Promise<void> { if (this.sendEnabled) this.textInComposer = false; }
  async setInputFiles(): Promise<void> {}
  async click(): Promise<void> {}

  async evaluate<T>(_h: SessionHandle, expression: string): Promise<T> {
    if (expression === "location.href") return "https://gemini.google.com/app" as T;
    if (expression.includes("location.reload")) {
      this.reloads += 1;
      this.remounted = true;
      this.textInComposer = false;
      this.sendEnabled = true;
      return true as T;
    }
    if (expression.includes("InputEvent")) return true as T;
    if (expression.includes("send.click()")) {
      this.clicks += 1;
      if (this.sendEnabled) this.textInComposer = false;
      return this.sendEnabled as T;
    }
    if (expression.includes("c.focus()")) return true as T;
    if (expression.includes("innerText || \"\").includes")) return this.promptInBody as T;
    if (expression.includes("trim().length > 0")) return this.textInComposer as T;
    // Mounted probe (composer only) vs send-readiness probe (both selectors).
    if (expression.includes("setInterval") && !expression.includes("button.send")) {
      return (this.remounted || !this.textInComposer) as T;
    }
    if (expression.includes("document.readyState")) return this.sendEnabled as T;
    return true as T;
  }
}

const handle: SessionHandle = { sessionId: "s", targetId: "t", adapterId: "firefox-bidi" };

describe("submitWithRecovery", () => {
  it("submits normally and never reloads when the send control works", async () => {
    const browser = new ScriptedBrowser();
    browser.sendEnabled = true;

    await submitWithRecovery(browser, handle, "div.ql-editor", "button.send", "hello", 500, 100);

    expect(browser.reloads).toBe(0);
    expect(browser.textInComposer).toBe(false);
  });

  it("reloads once and resubmits when the composer is stuck", async () => {
    recordManagedTab({ targetId: "t", platform: "gemini", url: "https://gemini.google.com/app", threadId: null, createdAt: "x" });
    const browser = new ScriptedBrowser();

    await submitWithRecovery(browser, handle, "div.ql-editor", "button.send", "stuck prompt", 1500, 100);

    expect(browser.reloads).toBe(1);
    expect(browser.textInComposer).toBe(false);
  });

  it("does not reload when the prompt already reached the conversation", async () => {
    const browser = new ScriptedBrowser();
    browser.promptInBody = true;

    await submitWithRecovery(browser, handle, "div.ql-editor", "button.send", "already sent", 200, 100);

    expect(browser.reloads).toBe(0);
  });
});
