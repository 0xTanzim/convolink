import { describe, expect, it } from "bun:test";
import {
  AuthChallengeError,
  BrowserConnectionError,
  LockAcquisitionError,
  TabNotFoundError,
  TimeoutError,
} from "../../src/core/errors/bridge-errors.js";
import { fromIpcFailure, toConvoError } from "../../src/core/errors/convo-error.js";

describe("toConvoError", () => {
  it("classifies a held tab lock as session-busy so callers can retry deliberately", () => {
    const mapped = toConvoError(new LockAcquisitionError("319051443", 770501, "/run/user/1000/convolink/tab.lock"));

    expect(mapped.code).toBe("session-busy");
    expect(mapped.retryable).toBe(true);
    expect(mapped.message).toContain("locked by active PID");
  });

  it("names how to start the bridge when the transport is disconnected", () => {
    const mapped = toConvoError(new BrowserConnectionError("ws://127.0.0.1:9224", "Extension is not connected"));

    expect(mapped.code).toBe("transport-disconnected");
    expect(mapped.retryable).toBe(true);
    expect(mapped.remediation).toContain("convo daemon start");
  });

  it("classifies a driver timeout as transport-timeout", () => {
    expect(toConvoError(new TimeoutError("DeepSeek response timed out", 60_000)).code).toBe("transport-timeout");
  });

  it("classifies a login wall distinctly from a challenge wall", () => {
    expect(toConvoError(new AuthChallengeError("login_required", "https://chat.deepseek.com/")).code).toBe(
      "login-required",
    );
    expect(toConvoError(new AuthChallengeError("turnstile", "https://chatgpt.com/")).code).toBe("challenge-detected");
  });

  it("carries the classification and retryability across the daemon boundary", () => {
    const busy = fromIpcFailure("session-busy", "Tab 1 is locked by active PID 2");
    expect(busy.code).toBe("session-busy");
    expect(busy.retryable).toBe(true);

    const unknown = fromIpcFailure(undefined, "boom");
    expect(unknown.code).toBe("internal");
    expect(unknown.retryable).toBe(false);
  });

  it("keeps an unrecognised failure internal", () => {
    const mapped = toConvoError(new TabNotFoundError("chatgpt", "42"));
    expect(mapped.code).toBe("internal");
    expect(mapped.message).toContain("No active browser tab");
  });
});
