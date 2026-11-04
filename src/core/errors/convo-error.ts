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
  | "not-owned"
  | "thread-not-found"
  | "login-required"
  | "challenge-detected"
  | "not-ready"
  | "submission-failed"
  | "daemon-required"
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
  // Refusing to close a tab ConvoLink did not open is a policy outcome.
  "not-owned": 4,
  "thread-not-found": 2,
  // Both need a human in the browser, which is a different failure class from
  // a transport problem: retrying the same command cannot succeed.
  "login-required": 4,
  "challenge-detected": 4,
  "not-ready": 5,
  "submission-failed": 5,
  "daemon-required": 3,
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

const BRIDGE_ERROR_CODES: Readonly<Record<string, ConvoErrorCode>> = {
  ERR_BROWSER_CONNECTION: "transport-disconnected",
  ERR_LOCK_ACQUISITION: "session-busy",
  ERR_TIMEOUT: "transport-timeout",
  ERR_PLATFORM_NOT_FOUND: "selection-unavailable",
  ERR_AUTH_CHALLENGE: "challenge-detected",
  ERR_AMBIGUOUS_TAB: "selection-unavailable",
};

/** Rebuilds a classified error from an IPC failure envelope. */
/** Remediation is part of the contract: a caller should not have to decode prose. */
const REMEDIATION: Partial<Record<ConvoErrorCode, string>> = {
  "transport-disconnected": "Start the bridge with `convo daemon start` (or `convo setup`), then retry.",
  "session-busy": "Another command holds this tab. Wait for it to finish, then retry.",
  "not-owned": "ConvoLink only closes tabs it opened. Close this one yourself, or pass force explicitly.",
  "login-required": "Sign in to the platform in that browser tab, then retry.",
  "challenge-detected": "Complete the verification challenge in the browser tab, then retry.",
  "extension-unsupported": "Reload the Companion extension so the running build matches the installed one, then retry.",
};

export function isRetryableCode(code: ConvoErrorCode): boolean {
  return code === "session-busy" || code === "transport-timeout" || code === "transport-disconnected" || code === "not-ready";
}

export function fromIpcFailure(code?: string, message?: string): ConvoError {
  const known = code && code in EXIT_CODES ? (code as ConvoErrorCode) : undefined;
  const resolved = known ?? "internal";
  return new ConvoError(
    resolved,
    message || "The daemon reported a failure.",
    REMEDIATION[resolved] ?? "Re-run with CONVOLINK_DEBUG=1 for details.",
    { retryable: isRetryableCode(resolved) },
  );
}

export function toConvoError(error: unknown, code?: ConvoErrorCode): ConvoError {
  if (isConvoError(error)) return error;
  const message = error instanceof Error ? error.message : String(error);
  const bridgeCode = (error as { code?: string } | null)?.code;
  const mapped = code ?? (bridgeCode ? BRIDGE_ERROR_CODES[bridgeCode] : undefined) ?? "internal";
  const challengeType = (error as { challengeType?: string } | null)?.challengeType;
  const resolved = challengeType === "login_required" ? "login-required" : mapped;
  return new ConvoError(resolved, message, REMEDIATION[resolved] ?? "Re-run with CONVOLINK_DEBUG=1 for details.", {
    cause: error,
    retryable: isRetryableCode(resolved),
  });
}
