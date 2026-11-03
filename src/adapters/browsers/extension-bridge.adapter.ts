import type { Server, ServerWebSocket } from "bun";
import type {
  BrowserCapabilities,
  BrowserPort,
  SessionHandle,
  TabDescriptor,
  TransportHealth,
} from "../../core/ports/browser.port.js";
import { BrowserConnectionError, TabNotFoundError } from "../../core/errors/bridge-errors.js";
import { ConvoError, type ConvoErrorCode } from "../../core/errors/convo-error.js";
import { ClientRegistry, mapClientTabs, type ClientHealth, type ConnectedClient } from "./extension-bridge.routing.js";
import { isLoopbackAddress, isValidExtensionOrigin, validateHandshakeToken } from "./extension-bridge.security.js";
import { formatCompoundTargetId, parseCompoundTargetId } from "../../core/ports/extension-protocol.js";
import type { BridgeTokenService } from "../../core/services/bridge-token.service.js";

interface PendingRequest {
  readonly ws: ServerWebSocket<unknown>;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_CLIENT_TTL_MS = 45_000;
const DEFAULT_SWEEP_INTERVAL_MS = 15_000;

export interface ExtensionBridgeOptions {
  readonly requestTimeoutMs?: number;
  readonly clientTtlMs?: number;
  readonly sweepIntervalMs?: number;
}

export class ExtensionBridgeAdapter implements BrowserPort {
  public readonly id = "extension-bridge" as const;
  public readonly capabilities: BrowserCapabilities = {
    protocol: "cdp",
    browserFamily: "chromium",
    supportsBackgroundLifecycle: true,
    supportsFileDownloads: false,
    supportsTabManagement: true,
  };

  private readonly port: number;
  private readonly tokenService?: BridgeTokenService;
  private server: Server<unknown> | null = null;
  private readonly registry = new ClientRegistry();
  private readonly pendingRequests = new Map<number, PendingRequest>();
  private messageCounter = 0;
  private sweeper: ReturnType<typeof setInterval> | null = null;
  private readonly requestTimeoutMs: number;
  private readonly clientTtlMs: number;
  private readonly sweepIntervalMs: number;

  constructor(port = 9224, tokenService?: BridgeTokenService, options: ExtensionBridgeOptions = {}) {
    this.port = port;
    this.tokenService = tokenService;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.clientTtlMs = options.clientTtlMs ?? DEFAULT_CLIENT_TTL_MS;
    this.sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  }

  public getConnectedClients(): ClientHealth[] {
    return this.registry.health();
  }

  public async start(): Promise<void> {
    if (this.server) return;
    const adapter = this;
    this.server = Bun.serve({
      port: this.port,
      hostname: "127.0.0.1",
      async fetch(req, server) {
        const pathname = new URL(req.url).pathname;
        if (req.method === "GET" && pathname === "/status") {
          try { await adapter.listTabs(); } catch {}
          return Response.json({ protocolVersion: 2, clients: adapter.registry.health() });
        }
        if (!isValidExtensionOrigin(req.headers.get("origin"))) return new Response("Forbidden: Origin", { status: 403 });
        if (!isLoopbackAddress(server.requestIP(req)?.address)) return new Response("Forbidden: IP", { status: 403 });
        if (server.upgrade(req, { data: undefined })) return undefined;
        return new Response("ConvoLink Extension Bridge", { status: 200 });
      },
      websocket: {
        open: () => {},
        message: (ws, msg) => { adapter.handleIncomingMessage(ws, msg.toString()); },
        close: (ws) => { adapter.handleDisconnect(ws); },
      },
    });
    this.sweeper ??= setInterval(() => this.evictStaleClients(), this.sweepIntervalMs);
  }

  public async stop(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
    if (this.server) {
      this.server.stop(true);
      this.server = null;
    }
    this.rejectAll(new Error("Adapter stopped"));
    for (const client of this.registry.getAll()) {
      try { client.ws.close(); } catch {}
    }
  }

  public async health(): Promise<TransportHealth> {
    const start = Date.now();
    await this.start();
    const clients = this.registry.health();
    const endpoint = `ws://127.0.0.1:${this.port}`;
    if (clients.length === 0) {
      return {
        ok: false,
        adapterId: this.id,
        endpoint,
        openTabsCount: 0,
        latencyMs: Date.now() - start,
        capabilities: this.capabilities,
        error: `No ConvoLink Companion extension connected on ${endpoint}`,
      };
    }
    try {
      const tabs = await this.listTabs();
      const labels = clients
        .map((client) => `${client.browserFamily} [${client.profileLabel}] v${client.extensionVersion}`)
        .join(", ");
      return {
        ok: true,
        adapterId: this.id,
        endpoint: `${endpoint} (${labels})`,
        openTabsCount: tabs.length,
        latencyMs: Date.now() - start,
        capabilities: this.capabilities,
      };
    } catch (error) {
      return {
        ok: false,
        adapterId: this.id,
        endpoint,
        openTabsCount: 0,
        latencyMs: Date.now() - start,
        error: (error as Error).message,
        capabilities: this.capabilities,
      };
    }
  }

  public async listTabs(): Promise<TabDescriptor[]> {
    await this.start();
    const clients = this.registry.getAll();
    const aggregated: TabDescriptor[] = [];
    for (const client of clients) {
      try {
        const tabs = await this.sendRequestToClient<Array<Record<string, unknown>>>(client.ws, "LIST_TABS", {});
        const mapped = mapClientTabs(Array.isArray(tabs) ? tabs : [], client, clients.length > 1);
        client.tabs = mapped;
        client.tabsReported = true;
        aggregated.push(...mapped);
      } catch {
        // One unresponsive browser must not hide tabs from the others.
      }
    }
    return aggregated;
  }

  public async attach(targetId: string): Promise<SessionHandle> {
    const tabs = await this.listTabs();
    if (!tabs.some((tab) => tab.targetId === targetId)) throw new TabNotFoundError(undefined, targetId);
    return { sessionId: `ext-${targetId}-${Date.now()}`, targetId, adapterId: this.id };
  }

  public async detach(_handle: SessionHandle): Promise<void> {}

  /**
   * Some SPAs (DeepSeek) only render the transcript in a visible tab, so a
   * hidden tab reports zero turns forever. Activating the tab is the only
   * lever available to a content-script transport; callers use it once, when
   * they have committed to waiting for a response.
   */
  public async keepAliveInBackground(handle: SessionHandle): Promise<void> {
    await this.sendAction("ACTIVATE_TAB", handle.targetId, {}).catch(() => undefined);
  }

  public async bringToFront(handle: SessionHandle): Promise<void> {
    await this.sendAction("BRING_TO_FRONT", handle.targetId, {});
  }

  public async trustedKey(handle: SessionHandle, key: string): Promise<void> {
    await this.sendAction("TRUSTED_KEY", handle.targetId, { key });
  }

  public async evaluate<T>(handle: SessionHandle, expression: string): Promise<T> {
    const operation = this.translateExpression(handle.targetId, expression);
    const result = await this.sendRequest<unknown>(operation.type, operation.payload, handle.targetId);
    return result as T;
  }

  public async fillText(handle: SessionHandle, selector: string, text: string): Promise<void> {
    // Trusted input first: a DOM-only fill leaves the platform's editor state
    // empty, so its send control ignores the click. The atomic TRUSTED_FILL is
    // preferred, and the composed sequence keeps older bundles working.
    try {
      const trusted = await this.sendRequest<{ ok?: boolean }>("TRUSTED_FILL", { selector, text }, handle.targetId);
      if (trusted?.ok) return;
    } catch {
      // Older bundles do not implement TRUSTED_FILL; compose the same steps.
      try {
        // Clearing an already-empty composer reports not-ready; that is fine.
        await this.sendRequest("FILL_TEXT", { selector, text: "" }, handle.targetId).catch(() => undefined);
        await this.sendRequest("FOCUS", { selector }, handle.targetId).catch(() => undefined);
        await this.sendAction("TRUSTED_TYPE", handle.targetId, { text });
        const hasText = await this.sendRequest<boolean>("PROBE_COMPOSER_TEXT", { selector }, handle.targetId);
        if (hasText) return;
      } catch {
        // Fall through to the DOM path below.
      }
    }
    const result = await this.sendRequest<{ ok?: boolean; error?: string }>(
      "FILL_TEXT",
      { selector, text },
      handle.targetId,
    );
    if (result && result.ok === false) {
      throw new ConvoError("not-ready", result.error || "Composer did not accept the text.", "Retry the prompt.", {
        retryable: true,
      });
    }
  }

  public click(handle: SessionHandle, selector: string): Promise<void> {
    return this.sendAction("CLICK", handle.targetId, { selector });
  }

  public pressKey(handle: SessionHandle, selector: string, key: string): Promise<void> {
    return this.sendAction("PRESS_KEY", handle.targetId, { selector, key });
  }

  public setInputFiles(): Promise<void> {
    return Promise.resolve();
  }

  public async createTab(url: string): Promise<TabDescriptor> {
    const client = this.registry.getAll().length === 1 ? this.registry.getAll()[0]! : this.registry.getPrimary();
    if (!client) throw new BrowserConnectionError(`ws://127.0.0.1:${this.port}`, "Extension is not connected");
    const result = await this.sendRequestToClient<{ tabId?: number; title?: string; url?: string }>(client.ws, "CREATE_TAB", { url });
    const nativeId = Number(result?.tabId);
    // Refresh the client's tab cache before callers probe the new tab; platform
    // routing is derived from that cache.
    await this.listTabs().catch(() => []);
    // Virtualized transcripts (DeepSeek) never render in a hidden tab, so a
    // freshly created automation tab is brought to the front immediately.
    if (Number.isFinite(nativeId)) {
      await this.sendAction("ACTIVATE_TAB", String(nativeId), {}).catch(() => undefined);
    }
    const multi = this.registry.getAll().length > 1;
    return {
      targetId: multi ? formatCompoundTargetId(client.clientId, nativeId) : String(nativeId),
      title: result?.title || "",
      url: result?.url || url,
    };
  }

  public closeTab(targetId: string): Promise<void> {
    return this.sendAction("CLOSE_TAB", targetId, {});
  }

  public navigate(handle: SessionHandle, url: string): Promise<void> {
    return this.sendAction("NAVIGATE", handle.targetId, { url });
  }

  /**
   * Escape hatch for diagnostics and capabilities the BrowserPort does not
   * model yet (scroll, hover, screenshot). Routed exactly like any other
   * command, so ownership and auth still apply.
   */
  public async rawCommand<T = unknown>(
    type: string,
    payload: Record<string, unknown> = {},
    targetId?: string,
  ): Promise<T> {
    return this.sendRequest<T>(type, payload, targetId);
  }

  private sendAction(type: string, targetId: string, extra: Record<string, unknown>): Promise<void> {
    return this.sendRequest<void>(type, extra, targetId);
  }

  private async sendRequest<T>(type: string, payload: Record<string, unknown>, targetId?: string): Promise<T> {
    await this.start();
    const route = targetId ? this.registry.findClientForTarget(targetId) : null;
    // A named target that no longer resolves must never fall back to another
    // browser just because it is the only one connected.
    const client = route?.client ?? (targetId ? null : this.registry.getAll().length === 1 ? this.registry.getPrimary() : null);
    if (!client) {
      throw new TabNotFoundError(undefined, targetId ?? "<no-target>");
    }
    const body = route ? { ...payload, targetId: route.rawTabId, platform: this.platformFor(route.client, targetId) } : payload;
    if (route && body.platform === null) {
      // The cached tab list can be stale after a reconnect; ask the extension
      // for the live URL rather than sending an unselectable command.
      try {
        const info = await this.sendRequestToClient<{ url?: string }>(client.ws, "TAB_INFO", { targetId: route.rawTabId });
        const platform = platformForUrl(info?.url ?? "");
        if (platform) return this.sendRequestToClient<T>(client.ws, type, { ...body, platform });
      } catch {
        // The tab is gone: sending with a null platform would surface as
        // "Unknown platform: null", which hides the real cause.
        throw new TabNotFoundError(undefined, targetId);
      }
    }
    return this.sendRequestToClient<T>(client.ws, type, body);
  }

  private trace(message: string): void {
    if (process.env.CONVOLINK_DEBUG === "1") process.stderr.write(`[ext-bridge] ${message}\n`);
  }

  private sendRequestToClient<T>(ws: ServerWebSocket<unknown>, type: string, payload: Record<string, unknown>): Promise<T> {
    const id = ++this.messageCounter;
    this.trace(
      `→ ${type} id=${id} target=${String(payload.targetId ?? "-")} platform=${String(payload.platform ?? "-")} ` +
        `payload=${JSON.stringify(payload).slice(0, 220)}`,
    );
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        this.trace(`✗ timeout ${type} id=${id} after ${this.requestTimeoutMs}ms`);
        reject(new ConvoError("transport-timeout", `Extension request ${type} timed out.`, "Reload the extension and retry.", { retryable: true }));
      }, this.requestTimeoutMs);
      this.pendingRequests.set(id, { ws, resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        ws.send(JSON.stringify({ v: 2, id, type, ...payload }));
      } catch (error) {
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(error as Error);
      }
    });
  }

  private platformFor(client: ConnectedClient, targetId?: string): string | null {
    const compound = targetId ? parseCompoundTargetId(targetId) : null;
    const nativeId = compound ? String(compound.tabId) : targetId;
    // A managed-tab record can outlive the connection that produced its id, so
    // compare on the trailing native id instead of demanding an exact match.
    const nativeOf = (value: string): string => value.split("::").pop() ?? value;
    const tab = client.tabs.find(
      (candidate) => candidate.targetId === targetId || nativeOf(candidate.targetId) === nativeId,
    );
    return tab ? platformForUrl(tab.url) : null;
  }

  private translateExpression(targetId: string, expression: string): { type: string; payload: Record<string, unknown> } {
    if (expression === "location.href") return { type: "GET_URL", payload: {} };
    if (expression.includes("/* getLastText */")) {
      return { type: "GET_LAST_TEXT", payload: { selector: firstQuoted(expression) ?? "" } };
    }
    if (expression.includes("/* getText */")) return { type: "GET_TEXT", payload: { selector: firstQuoted(expression) ?? "" } };
    if (expression.includes("location.reload")) return { type: "RELOAD", payload: {} };
    if (expression.includes("findContinuationTrigger")) return { type: "PROBE_CONTINUATION", payload: {} };
    if (expression.includes("findDownloadLinks")) return { type: "PROBE_DOWNLOADS", payload: {} };
    if (expression.includes("inspectCanvas")) return { type: "INSPECT_CANVAS", payload: {} };
    if (expression.includes("startNewChat")) return { type: "START_NEW_CHAT", payload: { baseUrl: firstQuoted(expression) ?? "" } };
    if (expression.includes("send.click()")) return { type: "CLICK", payload: { selector: lastQuoted(expression) ?? "" } };
    if (expression.includes("c.focus()")) return { type: "FOCUS", payload: { selector: lastQuoted(expression) ?? "" } };
    if (expression.includes("querySelectorAll(\"*\")") || expression.includes("querySelectorAll('*')")) {
      return { type: "PROBE_QUIET", payload: {} };
    }
    if (expression.includes("/* readThread */")) return { type: "READ_THREAD", payload: { lastN: 20 } };
    if (expression.includes("/* resolveSelectors */")) return { type: "PROBE_SELECTORS", payload: {} };
    if (expression.includes("/* awaitCompletion */") || expression.includes("assistantText")) {
      return { type: "PROBE_STATUS", payload: { beforeTurnCount: 0 } };
    }
    if (expression.includes("document.body.innerText")) {
      return { type: "GET_BODY_INCLUDES", payload: { text: allQuoted(expression).filter(Boolean).pop() ?? "" } };
    }
    const toggles = toggleContract(expression);
    if (toggles) return { type: "APPLY_TOGGLES", payload: { ...toggles } };

    const contract = selectorContract(expression);
    const requireContract = (label: string): SelectorContract => {
      if (!contract || !contract.composer) {
        throw new ConvoError(
          "extension-unsupported",
          `${label} probe is missing its convolink:selectors contract`,
          "Rebuild the host or use a transport that evaluates the probe directly.",
        );
      }
      return contract;
    };

    if (expression.includes("c.value || c.innerText")) {
      const selected = requireContract("Composer-text");
      return { type: "PROBE_COMPOSER_TEXT", payload: { selector: selected.composer } };
    }
    if (expression.includes("aria-disabled")) {
      const selected = requireContract("Ready");
      if (!selected.send) {
        throw new ConvoError(
          "extension-unsupported",
          "Ready probe is missing its send selector contract",
          "Rebuild the host or use a transport that evaluates the probe directly.",
        );
      }
      return { type: "PROBE_READY", payload: { composer: selected.composer, send: selected.send } };
    }
    if (expression.includes("document.readyState") && expression.includes("querySelector")) {
      const selected = requireContract("Mounted");
      return { type: "PROBE_MOUNTED", payload: { composer: selected.composer } };
    }
    throw new ConvoError(
      "extension-unsupported",
      `The extension transport cannot evaluate arbitrary JavaScript (MV3 CSP): ${expression.slice(0, 80)}`,
      "Use a CDP/Firefox transport for this platform, or add an operation for this probe.",
    );
  }

  private handleIncomingMessage(ws: ServerWebSocket<unknown>, raw: string): void {
    try {
      const message = JSON.parse(raw) as Record<string, unknown>;
      if (message.type === "HANDSHAKE") return this.handleHandshake(ws, message);
      if (message.type === "HEARTBEAT") {
        this.registry.touch(ws);
        ws.send(JSON.stringify({ type: "HEARTBEAT_ACK", timestamp: Date.now() }));
        return;
      }
      if (message.event === "TAB_REMOVED") {
        const targetId = String(message.targetId ?? "");
        for (const client of this.registry.getAll()) {
          client.tabs = client.tabs.filter((tab) => tab.targetId !== targetId && !tab.targetId.endsWith(`::${targetId}`));
        }
        return;
      }
      if (typeof message.id === "number" && this.pendingRequests.has(message.id)) {
        const pending = this.pendingRequests.get(message.id)!;
        this.pendingRequests.delete(message.id);
        clearTimeout(pending.timer);
        this.trace(
          `${message.ok === true ? "✓" : "✗"} id=${message.id} ` +
            (message.ok === true
              ? `result=${JSON.stringify(message.result)?.slice(0, 240)}`
              : JSON.stringify(message.error)),
        );
        if (message.ok === true) pending.resolve(message.result);
        else {
          const error = message.error as { code?: string; message?: string } | undefined;
          pending.reject(new ConvoError(asConvoCode(error?.code), error?.message ?? "Extension error", "Retry the command.", { retryable: true }));
        }
      }
    } catch {
      // Ignore malformed frames.
    }
  }

  private handleDisconnect(ws: ServerWebSocket<unknown>): void {
    this.registry.removeBySocket(ws);
    for (const [id, pending] of this.pendingRequests.entries()) {
      if (pending.ws !== ws) continue;
      clearTimeout(pending.timer);
      this.pendingRequests.delete(id);
      pending.reject(new ConvoError("transport-disconnected", "The extension disconnected mid-request.", "Reconnect the extension and retry.", { retryable: true }));
    }
  }

  private handleHandshake(ws: ServerWebSocket<unknown>, message: Record<string, unknown>): void {
    if (message.protocolVersion !== 2) {
      ws.send(JSON.stringify({ type: "HANDSHAKE_ACK", success: false, protocolVersion: 2, error: "protocol-mismatch" }));
      ws.close(4001, "protocol-mismatch");
      return;
    }
    const auth = validateHandshakeToken(message.token as string | undefined, this.tokenService);
    if (!auth.valid) {
      ws.send(JSON.stringify({ type: "HANDSHAKE_ACK", success: false, protocolVersion: 2, error: auth.error }));
      ws.close(4001, auth.error ?? "unauthorized");
      return;
    }
    const client = this.registry.register(ws, message as never);
    ws.send(JSON.stringify({ type: "HANDSHAKE_ACK", success: true, serverGeneration: client.serverGeneration, protocolVersion: 2 }));
  }

  private evictStaleClients(): void {
    for (const client of this.registry.evictStale(this.clientTtlMs)) {
      try { client.ws.close(4002, "heartbeat-timeout"); } catch {}
      this.handleDisconnect(client.ws);
    }
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}

const CONVO_CODES = new Set<string>([
  "configuration-required", "configuration-invalid", "no-browser-found", "selection-unavailable",
  "browser-unreachable", "profile-locked", "default-profile-blocked", "transport-mismatch",
  "transport-timeout", "transport-disconnected", "extension-unsupported", "session-busy",
  "thread-not-found", "not-ready", "submission-failed", "internal",
]);

function asConvoCode(code: string | undefined): ConvoErrorCode {
  return code && CONVO_CODES.has(code) ? (code as ConvoErrorCode) : "internal";
}

function platformForUrl(url: string): string | null {
  if (url.includes("chatgpt.com") || url.includes("chat.openai.com")) return "chatgpt";
  if (url.includes("claude.ai")) return "claude";
  if (url.includes("chat.deepseek.com")) return "deepseek";
  if (url.includes("gemini.google.com")) return "gemini";
  return null;
}

function allQuoted(expression: string): string[] {
  const matches = expression.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
  return matches.flatMap((value) => {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

interface SelectorContract {
  readonly composer?: string;
  readonly send?: string;
}

interface ToggleContract extends Record<string, unknown> {
  readonly selector: string;
  readonly selectedClass: string;
  readonly toggles: Record<string, { label: string; selected: boolean }>;
}

function toggleContract(expression: string): ToggleContract | null {
  const match = expression.match(/\/\*\s*convolink:toggles\s+(\{[\s\S]*?\})\s*\*\//);
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as ToggleContract;
    return parsed.selector && parsed.selectedClass && parsed.toggles ? parsed : null;
  } catch {
    return null;
  }
}

function selectorContract(expression: string): SelectorContract | null {
  const match = expression.match(/\/\*\s*convolink:selectors\s+(\{[\s\S]*?\})\s*\*\//);
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1]) as SelectorContract;
  } catch {
    return null;
  }
}

function firstQuoted(expression: string): string | null {
  return allQuoted(expression)[0] ?? null;
}

/**
 * Selectors are appended after any literal in the expression (for example
 * `document.readyState === "complete"`), so the last quoted string is the
 * selector. Taking the first one silently sent "complete" as a CSS selector.
 */
function lastQuoted(expression: string, offsetFromEnd = 0): string | null {
  const quoted = allQuoted(expression);
  return quoted[quoted.length - 1 - offsetFromEnd] ?? null;
}
