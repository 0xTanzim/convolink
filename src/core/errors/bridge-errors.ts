export type BridgeErrorCode =
  | "ERR_GENERAL"
  | "ERR_BROWSER_CONNECTION"
  | "ERR_TAB_NOT_FOUND"
  | "ERR_SELECTOR_RESOLUTION"
  | "ERR_TIMEOUT"
  | "ERR_LOCK_ACQUISITION"
  | "ERR_AUTH_CHALLENGE"
  | "ERR_POLICY_VIOLATION"
  | "ERR_PLATFORM_NOT_FOUND";

export class BridgeError extends Error {
  public readonly code: BridgeErrorCode;
  public readonly details?: Record<string, unknown>;

  constructor(message: string, code: BridgeErrorCode = "ERR_GENERAL", details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class BrowserConnectionError extends BridgeError {
  public readonly endpoint: string;

  constructor(endpoint: string, reason: string) {
    super(`Failed to connect to browser CDP endpoint at ${endpoint}: ${reason}`, "ERR_BROWSER_CONNECTION", {
      endpoint,
      reason,
    });
    this.endpoint = endpoint;
  }
}

export class TabNotFoundError extends BridgeError {
  public readonly platform?: string;
  public readonly query?: string;

  constructor(platform?: string, query?: string) {
    super(
      `No active browser tab found matching platform='${platform ?? "any"}' query='${query ?? "none"}'`,
      "ERR_TAB_NOT_FOUND",
      { platform, query },
    );
    this.platform = platform;
    this.query = query;
  }
}

export class SelectorResolutionError extends BridgeError {
  public readonly platform: string;
  public readonly attemptedSelectors: string[];

  constructor(platform: string, elementDescription: string, attemptedSelectors: string[]) {
    super(
      `Failed to resolve selector for ${elementDescription} on ${platform}. Tried: ${attemptedSelectors.join(", ")}`,
      "ERR_SELECTOR_RESOLUTION",
      { platform, elementDescription, attemptedSelectors },
    );
    this.platform = platform;
    this.attemptedSelectors = attemptedSelectors;
  }
}

export class TimeoutError extends BridgeError {
  public readonly timeoutMs: number;
  public readonly partialContent?: string;

  constructor(message: string, timeoutMs: number, partialContent?: string) {
    super(message, "ERR_TIMEOUT", { timeoutMs, hasPartialContent: Boolean(partialContent) });
    this.timeoutMs = timeoutMs;
    this.partialContent = partialContent;
  }
}

export class LockAcquisitionError extends BridgeError {
  public readonly targetId: string;
  public readonly holdingPid: number;
  public readonly lockPath: string;

  constructor(targetId: string, holdingPid: number, lockPath: string) {
    super(`Tab ${targetId} is locked by active PID ${holdingPid} (${lockPath})`, "ERR_LOCK_ACQUISITION", {
      targetId,
      holdingPid,
      lockPath,
    });
    this.targetId = targetId;
    this.holdingPid = holdingPid;
    this.lockPath = lockPath;
  }
}

export class AuthChallengeError extends BridgeError {
  public readonly challengeType: "cloudflare" | "turnstile" | "recaptcha" | "login_required";
  public readonly url: string;

  constructor(challengeType: "cloudflare" | "turnstile" | "recaptcha" | "login_required", url: string) {
    super(`Human intervention required: ${challengeType} challenge detected at ${url}`, "ERR_AUTH_CHALLENGE", {
      challengeType,
      url,
    });
    this.challengeType = challengeType;
    this.url = url;
  }
}

export class PlatformDriverNotFoundError extends BridgeError {
  public readonly url: string;

  constructor(url: string) {
    super(`No platform driver registered matching URL: ${url}`, "ERR_PLATFORM_NOT_FOUND", { url });
    this.url = url;
  }
}
