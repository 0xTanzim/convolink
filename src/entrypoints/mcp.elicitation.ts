/**
 * MCP server→client elicitation (`elicitation/create`).
 *
 * A harness that advertises the capability can render a real question modal and
 * pause the turn. Everything else gets the text fallback the tool already
 * returns, so no client ever hangs waiting for a request it cannot answer.
 */

export interface ElicitationSchemaProperty {
  readonly type: "string";
  readonly title?: string;
  readonly description?: string;
  readonly enum?: readonly string[];
}

export interface ElicitationRequestedSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, ElicitationSchemaProperty>>;
  readonly required?: readonly string[];
}

export interface ElicitationRequest {
  readonly message: string;
  readonly requestedSchema: ElicitationRequestedSchema;
}

export interface ElicitationResponse {
  readonly action: "accept" | "decline" | "cancel";
  readonly content?: Record<string, unknown>;
}

export interface ElicitationPort {
  readonly supported: boolean;
  request(request: ElicitationRequest): Promise<ElicitationResponse>;
}

export interface ElicitationBridgeOptions {
  readonly write: (message: unknown) => void;
  readonly timeoutMs?: number;
  readonly idPrefix?: string;
}

export interface ElicitationBridge {
  readonly port: ElicitationPort;
  readonly setSupported: (supported: boolean) => void;
  /** Returns true when the message was a reply to a pending request. */
  readonly handleResponse: (message: { id?: unknown; result?: unknown; error?: unknown }) => boolean;
  readonly pendingCount: () => number;
}

export const ELICITATION_TIMEOUT_MS = 300_000;

function parseResponse(result: unknown, error: unknown): ElicitationResponse {
  if (error) return { action: "cancel" };
  if (!result || typeof result !== "object") return { action: "cancel" };
  const action = (result as { action?: unknown }).action;
  if (action === "decline") return { action: "decline" };
  if (action !== "accept") return { action: "cancel" };
  const content = (result as { content?: unknown }).content;
  return {
    action: "accept",
    ...(content && typeof content === "object" && !Array.isArray(content) ? { content: content as Record<string, unknown> } : {}),
  };
}

export function createElicitationBridge(options: ElicitationBridgeOptions): ElicitationBridge {
  const timeoutMs = options.timeoutMs ?? ELICITATION_TIMEOUT_MS;
  const idPrefix = options.idPrefix ?? "elicit";
  const pending = new Map<string, (response: ElicitationResponse) => void>();
  let sequence = 0;
  let supported = false;

  const settle = (id: string, response: ElicitationResponse): void => {
    const resolve = pending.get(id);
    if (!resolve) return;
    pending.delete(id);
    resolve(response);
  };

  return {
    port: {
      get supported() {
        return supported;
      },
      request: (request: ElicitationRequest) => {
        sequence += 1;
        const id = `${idPrefix}-${sequence}`;
        return new Promise<ElicitationResponse>((resolve) => {
          pending.set(id, resolve);
          // A client that never answers must not strand the tool call: the
          // timeout degrades to the same outcome as an explicit cancel.
          setTimeout(() => settle(id, { action: "cancel" }), timeoutMs);
          options.write({
            jsonrpc: "2.0",
            id,
            method: "elicitation/create",
            params: { message: request.message, requestedSchema: request.requestedSchema },
          });
        });
      },
    },
    setSupported: (value: boolean) => {
      supported = value;
    },
    handleResponse: (message) => {
      if (typeof message.id !== "string" || !pending.has(message.id)) return false;
      settle(message.id, parseResponse(message.result, message.error));
      return true;
    },
    pendingCount: () => pending.size,
  };
}
