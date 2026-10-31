import { describe, expect, it } from "bun:test";
import { detectBrowserProtocol } from "../../src/adapters/browsers/protocol-detector.js";

describe("detectBrowserProtocol", () => {
  it("detects CDP when /json/version responds with Chromium metadata", async () => {
    const mockFetcher = async () => {
      return new Response(JSON.stringify({ Browser: "Chrome/130.0", "Protocol-Version": "1.3" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const protocol = await detectBrowserProtocol(9222, mockFetcher);
    expect(protocol).toBe("cdp");
  });

  it("detects webdriver-bidi when /json/version is unavailable or non-CDP", async () => {
    const mockFetcher = async () => {
      throw new Error("Connection refused or 404");
    };

    const protocol = await detectBrowserProtocol(9222, mockFetcher);
    expect(protocol).toBe("webdriver-bidi");
  });
});
