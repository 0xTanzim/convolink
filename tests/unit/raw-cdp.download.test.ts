import { describe, expect, it } from "bun:test";
import { RawCdpAdapter } from "../../src/adapters/browsers/raw-cdp.adapter.js";
import type { SessionHandle } from "../../src/core/ports/browser.port.js";

describe("RawCdpAdapter File Download", () => {
  const adapter = new RawCdpAdapter();
  const handle: SessionHandle = { sessionId: "s1", targetId: "t1", adapterId: "raw-cdp" };

  it("fetches in-browser file URL via evaluate and decodes base64 buffer", async () => {
    const originalEvaluate = adapter.evaluate;
    adapter.evaluate = (async <T>() => {
      // Base64 encoding of "Hello CDP Sandbox File"
      const payloadBase64 = Buffer.from("Hello CDP Sandbox File").toString("base64");
      return `data:text/plain;base64,${payloadBase64}` as unknown as T;
    }) as typeof adapter.evaluate;

    try {
      const buffer = await adapter.downloadFile(handle, "/backend-api/files/download/123");
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.toString("utf8")).toBe("Hello CDP Sandbox File");
    } finally {
      adapter.evaluate = originalEvaluate;
    }
  });

  it("handles empty or invalid download data URL gracefully", async () => {
    const originalEvaluate = adapter.evaluate;
    adapter.evaluate = (async <T>() => null as unknown as T) as typeof adapter.evaluate;

    try {
      expect(adapter.downloadFile(handle, "/invalid/url")).rejects.toThrow();
    } finally {
      adapter.evaluate = originalEvaluate;
    }
  });
});
