export const EXTENSION_PROTOCOL_VERSION = 2 as const;

export type BrowserFamily = "chrome" | "brave" | "edge" | "firefox";

export type ExtensionErrorCode =
  | "protocol-mismatch"
  | "unauthorized"
  | "unsupported"
  | "unsupported-expression"
  | "timeout"
  | "tab-not-found"
  | "not-owned"
  | "not-ready"
  | "submission-failed"
  | "internal";

export interface ExtensionError {
  readonly code: ExtensionErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

export type ExtensionCommand =
  | "PING"
  | "LIST_TABS"
  | "GET_URL"
  | "GET_TEXT"
  | "GET_LAST_TEXT"
  | "GET_BODY_INCLUDES"
  | "PROBE_SELECTORS"
  | "PROBE_MOUNTED"
  | "PROBE_READY"
  | "APPLY_TOGGLES"
  | "TRIGGER_CONTINUATION"
  | "PROBE_QUIET"
  | "PROBE_COMPOSER_TEXT"
  | "READ_THREAD"
  | "PROBE_STATUS"
  | "PROBE_CONTINUATION"
  | "PROBE_DOWNLOADS"
  | "INSPECT_CANVAS"
  | "FOCUS"
  | "RELOAD"
  | "START_NEW_CHAT"
  | "FILL_TEXT"
  | "TYPE_TEXT"
  | "CLICK"
  | "HOVER"
  | "SCROLL"
  | "SCROLL_TO"
  | "PRESS_KEY"
  | "TRUSTED_KEY"
  | "TRUSTED_TYPE"
  | "TRUSTED_FILL"
  | "WAIT_FOR_SELECTOR"
  | "SELECT_OPTION"
  | "GET_HTML"
  | "DIAGNOSE"
  | "BRING_TO_FRONT"
  | "ACTIVATE_TAB"
  | "TAB_INFO"
  | "CREATE_TAB"
  | "CLOSE_TAB"
  | "DUPLICATE_TAB"
  | "SCREENSHOT"
  | "NAVIGATE";

export interface ClientHandshake {
  readonly protocolVersion: typeof EXTENSION_PROTOCOL_VERSION;
  readonly clientId: string;
  readonly installationProfileId: string;
  readonly connectionId: string;
  readonly browserFamily: BrowserFamily;
  readonly profileLabel: string;
  readonly extensionVersion: string;
  readonly buildId?: string;
  readonly token?: string;
}

export interface HandshakeAck {
  readonly success: boolean;
  readonly serverGeneration: number;
  readonly protocolVersion: typeof EXTENSION_PROTOCOL_VERSION;
  readonly error?: string;
}

export interface BrowserTarget {
  readonly targetId: string;
  readonly clientId: string;
  readonly connectionId: string;
  readonly tabId: number;
  readonly url: string;
  readonly title: string;
  readonly browserFamily: BrowserFamily;
  readonly profileLabel: string;
}

export interface DiscoveredExtensionTab {
  readonly tabId: number;
  readonly url: string;
  readonly title: string;
  readonly windowId?: number;
  readonly active?: boolean;
  readonly owned?: boolean;
  readonly platform?: string | null;
}

export interface ExtensionRequest {
  readonly v: typeof EXTENSION_PROTOCOL_VERSION;
  readonly id: number;
  readonly type: ExtensionCommand;
  readonly [key: string]: unknown;
}

export interface ExtensionSuccess<T = unknown> {
  readonly v: typeof EXTENSION_PROTOCOL_VERSION;
  readonly id: number;
  readonly ok: true;
  readonly result: T;
}

export interface ExtensionFailure {
  readonly v: typeof EXTENSION_PROTOCOL_VERSION;
  readonly id: number;
  readonly ok: false;
  readonly error: ExtensionError;
}

export type ExtensionResponse<T = unknown> = ExtensionSuccess<T> | ExtensionFailure;

export interface TabRemovedEvent {
  readonly v: typeof EXTENSION_PROTOCOL_VERSION;
  readonly event: "TAB_REMOVED";
  readonly targetId: string;
}

export function formatCompoundTargetId(clientId: string, tabId: number): string {
  return `${clientId}::${tabId}`;
}

export function parseCompoundTargetId(compoundId: string): { clientId: string; tabId: number } | null {
  if (!compoundId || typeof compoundId !== "string") return null;
  const parts = compoundId.split("::");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const tabId = parseInt(parts[1], 10);
  if (isNaN(tabId)) return null;
  return { clientId: parts[0], tabId };
}

export function isExtensionError(value: unknown): value is ExtensionError {
  return Boolean(value && typeof value === "object" && "code" in value && "message" in value);
}
