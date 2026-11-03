export type ConvoErrorCode =
  | "configuration-required"
  | "configuration-invalid"
  | "no-browser-found"
  | "selection-unavailable"
  | "browser-unreachable"
  | "profile-locked"
  | "default-profile-blocked"
  | "transport-mismatch"
  | "transport-timeout"
  | "transport-disconnected"
  | "extension-unsupported"
  | "session-busy"
  | "thread-not-found"
  | "not-ready"
  | "submission-failed"
  | "internal";

/**
 * Exit codes are part of the caller contract: a program branches on these
 * instead of parsing prose.
 */
export const EXIT_CODES: Readonly<Record<ConvoErrorCode, number>> = {
  "configuration-required": 2,
  "configuration-invalid": 2,
  "no-browser-found": 2,
  "selection-unavailable": 2,
  "browser-unreachable": 3,
  "profile-locked": 3,
  "default-profile-blocked": 3,
  "transport-mismatch": 3,
  "transport-timeout": 3,
  "transport-disconnected": 3,
  "extension-unsupported": 3,
  "session-busy": 4,
  "thread-not-found": 2,
  "not-ready": 5,
  "submission-failed": 5,
  internal: 6,
};

export interface ConvoErrorInit {
  readonly retryable?: boolean;
  readonly cause?: unknown;
}

export interface ConvoErrorJson {
  readonly code: ConvoErrorCode;
  readonly message: string;
  readonly remediation: string;
  readonly retryable: boolean;
}

export class ConvoError extends Error {
  public readonly code: ConvoErrorCode;
  public readonly remediation: string;
  public readonly retryable: boolean;
  public readonly exitCode: number;

  public constructor(code: ConvoErrorCode, message: string, remediation: string, init: ConvoErrorInit = {}) {
    super(message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = "ConvoError";
    this.code = code;
    this.remediation = remediation;
    this.retryable = init.retryable ?? false;
    this.exitCode = EXIT_CODES[code];
  }

  public toJSON(): ConvoErrorJson {
    return {
      code: this.code,
      message: this.message,
      remediation: this.remediation,
      retryable: this.retryable,
    };
  }
}

export function isConvoError(error: unknown): error is ConvoError {
  return error instanceof ConvoError;
}

export function toConvoError(error: unknown, code: ConvoErrorCode = "internal"): ConvoError {
  if (isConvoError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ConvoError(code, message, "Re-run with CONVOLINK_DEBUG=1 for details.", { cause: error });
}
