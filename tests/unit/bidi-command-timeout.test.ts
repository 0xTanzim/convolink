import { describe, expect, it } from "bun:test";
import { FirefoxBidiAdapter } from "../../src/adapters/browsers/firefox-bidi.adapter.js";

const handle = { sessionId: "s", targetId: "ctx", adapterId: "firefox-bidi" as const };

describe("Firefox BiDi command isolation", () => {
  it("fails one stuck command instead of hanging the whole session", async () => {
    const adapter = new FirefoxBidiAdapter(1, async () => new Promise(() => {}), {
      commandTimeoutMs: 25,
    });

    await expect(adapter.evaluate(handle, "1")).rejects.toThrow(/timed out after 25ms/);
  });

  it("keeps working for commands that answer in time", async () => {
    const adapter = new FirefoxBidiAdapter(
      1,
      async (method) => ({ result: { value: method }, type: "success" }),
      { commandTimeoutMs: 200 },
    );

    await expect(adapter.evaluate(handle, "1")).resolves.toBe("script.evaluate");
  });
});
