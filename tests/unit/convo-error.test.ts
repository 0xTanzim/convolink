import { describe, expect, it } from "bun:test";
import {
  ConvoError,
  EXIT_CODES,
  isConvoError,
  toConvoError,
  type ConvoErrorCode,
} from "../../src/core/errors/convo-error.js";

const CODES: ConvoErrorCode[] = [
  "configuration-required",
  "configuration-invalid",
  "no-browser-found",
  "selection-unavailable",
  "browser-unreachable",
  "profile-locked",
  "default-profile-blocked",
  "transport-mismatch",
  "session-busy",
  "not-ready",
  "submission-failed",
  "internal",
];

describe("ConvoError", () => {
  it("maps every code to its documented exit code", () => {
    expect(EXIT_CODES["configuration-required"]).toBe(2);
    expect(EXIT_CODES["configuration-invalid"]).toBe(2);
    expect(EXIT_CODES["browser-unreachable"]).toBe(3);
    expect(EXIT_CODES["default-profile-blocked"]).toBe(3);
    expect(EXIT_CODES["session-busy"]).toBe(4);
    expect(EXIT_CODES["not-ready"]).toBe(5);
    expect(EXIT_CODES["submission-failed"]).toBe(5);
    expect(EXIT_CODES.internal).toBe(6);

    for (const code of CODES) {
      const error = new ConvoError(code, "boom", "do the thing");
      expect(error.exitCode).toBe(EXIT_CODES[code]);
      expect(error.retryable).toBe(false);
    }
  });

  it("serializes to a structured error document", () => {
    const error = new ConvoError("session-busy", "already in use", "restart firefox", { retryable: true });
    expect(error.toJSON()).toEqual({
      code: "session-busy",
      message: "already in use",
      remediation: "restart firefox",
      retryable: true,
    });
  });

  it("wraps unknown failures without losing the cause", () => {
    const wrapped = toConvoError(new Error("kaboom"));
    expect(wrapped.code).toBe("internal");
    expect(wrapped.message).toBe("kaboom");
    expect(wrapped.cause).toBeInstanceOf(Error);
    expect(isConvoError(wrapped)).toBe(true);
  });

  it("passes an existing ConvoError through unchanged", () => {
    const original = new ConvoError("not-ready", "composer missing", "retry");
    expect(toConvoError(original)).toBe(original);
  });
});
