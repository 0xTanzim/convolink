import type {
  BrowserCapabilities,
  BrowserPort,
  SessionHandle,
  TabDescriptor,
  TransportHealth,
} from "../../core/ports/browser.port.js";
import { BrowserConnectionError, TabNotFoundError } from "../../core/errors/bridge-errors.js";
import { ConvoError } from "../../core/errors/convo-error.js";
import { mapClientTabs, type ClientHealth, type ConnectedClient } from "./extension-bridge.routing.js";
import { formatCompoundTargetId, parseCompoundTargetId } from "../../core/ports/extension-protocol.js";
import type { BridgeTokenService } from "../../core/services/bridge-token.service.js";
import { translateExpression } from "./extension-bridge.translator.js";
import { ExtensionBridgeServer, type ExtensionBridgeOptions } from "./extension-bridge.server.js";

export { type ExtensionBridgeOptions } from "./extension-bridge.server.js";

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
  private readonly server: ExtensionBridgeServer;

  constructor(port = 9224, tokenService?: BridgeTokenService, options: ExtensionBridgeOptions = {}) {
    this.port = port;
    this.server = new ExtensionBridgeServer({
      port,
      tokenService,
      ...options,
      onListTabsRequested: async () => {
        try { await this.listTabs(); } catch {}
      },
    });
  }

  public getConnectedClients(): ClientHealth[] {
    return this.server.getConnectedClients();
  }

  public async start(): Promise<void> {
    await this.server.start();
  }

  public async stop(): Promise<void> {
    await this.server.stop();
  }

  public async health(): Promise<TransportHealth> {
    const start = Date.now();
    const endpoint = `ws://127.0.0.1:${this.port}`;
    const makeHealth = (ok: boolean, count: number, labels?: string, error?: string): TransportHealth => ({
      ok,
      adapterId: this.id,
      endpoint: labels ? `${endpoint} (${labels})` : endpoint,
      openTabsCount: count,
      latencyMs: Date.now() - start,
      capabilities: this.capabilities,
      ...(error ? { error } : {}),
    });

    if (!this.server.isListening()) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.port}/status`, { signal: AbortSignal.timeout(300) });
        if (res.ok) {
          const body = (await res.json()) as { clients?: ClientHealth[] };
          const clients = body.clients || [];
          const count = clients.reduce((sum, c) => sum + (c.tabCount || (c as any).tabsCount || 0), 0);
          if (clients.length === 0) return makeHealth(false, 0, undefined, `No ConvoLink Companion extension connected on ${endpoint}`);
          return makeHealth(true, count, formatClientLabels(clients));
        }
      } catch {}
    }

    try { await this.start(); } catch (e) {
      return makeHealth(false, 0, undefined, (e as Error).message);
    }

    const clients = this.server.getConnectedClients();
    if (clients.length === 0) return makeHealth(false, 0, undefined, `No ConvoLink Companion extension connected on ${endpoint}`);

    try {
      const tabs = await this.listTabs();
      return makeHealth(true, tabs.length, formatClientLabels(clients));
    } catch (e) {
      return makeHealth(false, 0, undefined, (e as Error).message);
    }
  }

  public async listTabs(): Promise<TabDescriptor[]> {
    await this.start();
    const clients = this.server.registry.getAll();
    const aggregated: TabDescriptor[] = [];
    for (const client of clients) {
      try {
        const tabs = await this.server.sendRequestToClient<Array<Record<string, unknown>>>(client.ws, "LIST_TABS", {});
        const mapped = mapClientTabs(Array.isArray(tabs) ? tabs : [], client, clients.length > 1);
        client.tabs = mapped;
        client.tabsReported = true;
        aggregated.push(...mapped);
      } catch {}
    }
    return aggregated;
  }

  public async attach(targetId: string): Promise<SessionHandle> {
    const tabs = await this.listTabs();
    if (!tabs.some((tab) => tab.targetId === targetId)) throw new TabNotFoundError(undefined, targetId);
    return { sessionId: `ext-${targetId}-${Date.now()}`, targetId, adapterId: this.id };
  }

  public async detach(_handle: SessionHandle): Promise<void> {}

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
    const operation = translateExpression(handle.targetId, expression);
    const result = await this.sendRequest<unknown>(operation.type, operation.payload, handle.targetId);
    if (expression.includes("/* authCheck */")) return Boolean(!result) as T;
    return result as T;
  }

  public async fillText(handle: SessionHandle, selector: string, text: string): Promise<void> {
    try {
      const trusted = await this.sendRequest<{ ok?: boolean }>("TRUSTED_FILL", { selector, text }, handle.targetId);
      if (trusted?.ok) return;
    } catch {
      try {
        await this.sendRequest("FILL_TEXT", { selector, text: "" }, handle.targetId).catch(() => undefined);
        await this.sendRequest("FOCUS", { selector }, handle.targetId).catch(() => undefined);
        await this.sendAction("TRUSTED_TYPE", handle.targetId, { text });
        const hasText = await this.sendRequest<boolean>("PROBE_COMPOSER_TEXT", { selector }, handle.targetId);
        if (hasText) return;
      } catch {}
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
    const clients = this.server.registry.getAll();
    const client = clients.length === 1 ? clients[0]! : this.server.registry.getPrimary();
    if (!client) throw new BrowserConnectionError(`ws://127.0.0.1:${this.port}`, "Extension is not connected");
    const result = await this.server.sendRequestToClient<{ tabId?: number; title?: string; url?: string }>(
      client.ws,
      "CREATE_TAB",
      { url },
    );
    const nativeId = Number(result?.tabId);
    await this.listTabs().catch(() => []);
    if (Number.isFinite(nativeId)) {
      await this.sendAction("ACTIVATE_TAB", String(nativeId), {}).catch(() => undefined);
    }
    const multi = clients.length > 1;
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
    const route = targetId ? this.server.registry.findClientForTarget(targetId) : null;
    const client =
      route?.client ??
      (targetId ? null : this.server.registry.getAll().length === 1 ? this.server.registry.getPrimary() : null);
    if (!client) throw new TabNotFoundError(undefined, targetId ?? "<no-target>");
    const body = route
      ? { ...payload, targetId: route.rawTabId, platform: this.platformFor(route.client, targetId) }
      : payload;
    if (route && body.platform === null) {
      try {
        const info = await this.server.sendRequestToClient<{ url?: string }>(client.ws, "TAB_INFO", {
          targetId: route.rawTabId,
        });
        const platform = platformForUrl(info?.url ?? "");
        if (platform) return this.server.sendRequestToClient<T>(client.ws, type, { ...body, platform });
      } catch {
        throw new TabNotFoundError(undefined, targetId);
      }
    }
    return this.server.sendRequestToClient<T>(client.ws, type, body);
  }

  private platformFor(client: ConnectedClient, targetId?: string): string | null {
    const compound = targetId ? parseCompoundTargetId(targetId) : null;
    const nativeId = compound ? String(compound.tabId) : targetId;
    const nativeOf = (value: string): string => value.split("::").pop() ?? value;
    const tab = client.tabs.find(
      (candidate) => candidate.targetId === targetId || nativeOf(candidate.targetId) === nativeId,
    );
    return tab ? platformForUrl(tab.url) : null;
  }
}

function formatClientLabels(clients: readonly ClientHealth[]): string {
  return clients.map((c) => `${c.browserFamily} [${c.profileLabel}] v${c.extensionVersion}`).join(", ");
}

function platformForUrl(url: string): string | null {
  if (url.includes("chatgpt.com") || url.includes("chat.openai.com")) return "chatgpt";
  if (url.includes("claude.ai")) return "claude";
  if (url.includes("chat.deepseek.com")) return "deepseek";
  if (url.includes("gemini.google.com")) return "gemini";
  return null;
}
