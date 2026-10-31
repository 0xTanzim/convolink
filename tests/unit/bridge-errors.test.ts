import { describe, expect, it } from "bun:test";
import {
  AuthChallengeError,
  BridgeError,
  BrowserConnectionError,
  LockAcquisitionError,
  SelectorResolutionError,
  TabNotFoundError,
  TimeoutError,
} from "../../src/core/errors/bridge-errors.js";

describe("Domain Errors", () => {
  it("creates structured BridgeError with code and details", () => {
    const err = new BridgeError("General failure", "ERR_GENERAL", { detail: "test" });
    expect(err.message).toBe("General failure");
    expect(err.code).toBe("ERR_GENERAL");
    expect(err.details).toEqual({ detail: "test" });
    expect(err instanceof Error).toBe(true);
  });

  it("handles BrowserConnectionError", () => {
    const err = new BrowserConnectionError("127.0.0.1:9222", "Connection refused");
    expect(err.code).toBe("ERR_BROWSER_CONNECTION");
    expect(err.endpoint).toBe("127.0.0.1:9222");
    expect(err.message).toContain("127.0.0.1:9222");
  });

  it("handles TabNotFoundError", () => {
    const err = new TabNotFoundError("deepseek", "chat.deepseek.com");
    expect(err.code).toBe("ERR_TAB_NOT_FOUND");
    expect(err.platform).toBe("deepseek");
  });

  it("handles TimeoutError with partial text preservation", () => {
    const err = new TimeoutError("DeepSeek timed out", 30000, "Partial response token stream");
    expect(err.code).toBe("ERR_TIMEOUT");
    expect(err.timeoutMs).toBe(30000);
    expect(err.partialContent).toBe("Partial response token stream");
  });

  it("handles LockAcquisitionError with owning PID", () => {
    const err = new LockAcquisitionError("tab-123", 4567, "/run/user/1000/omni-bridge/tab-123.lock");
    expect(err.code).toBe("ERR_LOCK_ACQUISITION");
    expect(err.holdingPid).toBe(4567);
  });

  it("handles AuthChallengeError with intervention details", () => {
    const err = new AuthChallengeError("cloudflare", "https://chatgpt.com");
    expect(err.code).toBe("ERR_AUTH_CHALLENGE");
    expect(err.challengeType).toBe("cloudflare");
  });
});
