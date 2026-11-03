import { describe, expect, it } from "bun:test";
import { pollUntilSettled, completionText, hasNewCompletion } from "../../src/adapters/platforms/driver-helpers.js";
import type { BrowserPort, SessionHandle, TabDescriptor, TransportHealth } from "../../src/core/ports/browser.port.js";
import type { TurnFingerprint } from "../../src/core/ports/platform.port.js";

const handle: SessionHandle = { sessionId: "s", targetId: "t", adapterId: "extension-bridge" };
const before: TurnFingerprint = { turnCount: 1, lastTurnHash: "", submittedPromptHash: "1" };

class StaticThinkingBrowser implements BrowserPort {
  public readonly id = "extension-bridge" as const;
  public probes = 0;
  public nudges = 0;

  async health(): Promise<TransportHealth> {
    return { ok: true, adapterId: this.id, endpoint: "x", openTabsCount: 1, latencyMs: 0 };
  }
  async listTabs(): Promise<TabDescriptor[]> {
    return [{ targetId: "t", url: "https://chat.deepseek.com/", title: "DeepSeek" }];
  }
  async attach(targetId: string): Promise<SessionHandle> {
    return { sessionId: "s", targetId, adapterId: this.id };
  }
  async detach(): Promise<void> {}
  async keepAliveInBackground(): Promise<void> {
    this.nudges += 1;
  }
  async bringToFront(): Promise<void> {}
  async fillText(): Promise<void> {}
  async click(): Promise<void> {}
  async pressKey(): Promise<void> {}
  async setInputFiles(): Promise<void> {}

  async evaluate<T>(): Promise<T> {
    this.probes += 1;
    // The answer is finished, but the reasoning panel stays mounted forever.
    return {
      turnsCount: 2,
      hasNewTurn: true,
      isGenerating: false,
      isThinking: true,
      assistantText: "the answer",
    } as T;
  }
}

describe("pollUntilSettled", () => {
  it("completes while a reasoning panel stays mounted, because output is stable", async () => {
    const browser = new StaticThinkingBrowser();
    const started = Date.now();

    const result = await pollUntilSettled(browser, handle, "probe", {
      timeoutMs: 5_000,
      quiescenceMs: 400,
      textOf: completionText,
      isNew: (status) => hasNewCompletion(status, before),
    });

    expect(result.timedOut).toBe(false);
    expect(completionText(result.status)).toBe("the answer");
    // Well before the timeout: the static thinking flag must not hold the loop.
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(browser.nudges).toBe(1);
  });

  it("does not report completion when the newest turn is only the user prompt", async () => {
    const browser = new StaticThinkingBrowser();
    browser.evaluate = async <T>(): Promise<T> =>
      ({ turnsCount: 2, hasNewTurn: true, isGenerating: false, isThinking: false, assistantText: "" }) as T;

    const result = await pollUntilSettled(browser, handle, "probe", {
      timeoutMs: 600,
      quiescenceMs: 100,
      textOf: completionText,
      isNew: (status) => hasNewCompletion(status, before),
    });

    expect(result.timedOut).toBe(true);
  });
});
