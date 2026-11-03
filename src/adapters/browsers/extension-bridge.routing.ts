import type { ServerWebSocket } from "bun";
import type { TabDescriptor } from "../../core/ports/browser.port.js";
import {
  parseCompoundTargetId,
  type BrowserFamily,
  type ClientHandshake,
} from "../../core/ports/extension-protocol.js";

export interface ConnectedClient {
  readonly ws: ServerWebSocket<unknown>;
  readonly clientId: string;
  readonly installationProfileId: string;
  readonly connectionId: string;
  readonly serverGeneration: number;
  readonly browserFamily: BrowserFamily;
  readonly profileLabel: string;
  readonly extensionVersion: string;
  lastHeartbeat: number;
  tabs: TabDescriptor[];
  tabsReported: boolean;
}

export interface ClientHealth {
  readonly clientId: string;
  readonly installationProfileId: string;
  readonly connectionId: string;
  readonly browserFamily: BrowserFamily;
  readonly profileLabel: string;
  readonly extensionVersion: string;
  readonly tabCount: number;
  readonly lastHeartbeat: number;
}

export class ClientRegistry {
  private readonly clients = new Map<string, ConnectedClient>();
  private generationCounter = 0;

  public register(ws: ServerWebSocket<unknown>, handshake: Partial<ClientHandshake> & { type?: string }): ConnectedClient {
    const installId = handshake.installationProfileId || handshake.clientId || `client-${Date.now()}`;
    const client: ConnectedClient = {
      ws,
      clientId: handshake.clientId || installId,
      installationProfileId: installId,
      connectionId: handshake.connectionId || `conn-${Date.now()}`,
      serverGeneration: ++this.generationCounter,
      browserFamily: handshake.browserFamily || "chrome",
      profileLabel: handshake.profileLabel || "Default",
      extensionVersion: handshake.extensionVersion || "0.0.0",
      lastHeartbeat: Date.now(),
      tabs: [],
      tabsReported: false,
    };
    this.clients.set(installId, client);
    return client;
  }

  public removeBySocket(ws: ServerWebSocket<unknown>): ConnectedClient | null {
    for (const [installId, client] of this.clients.entries()) {
      if (client.ws === ws) {
        this.clients.delete(installId);
        return client;
      }
    }
    return null;
  }

  public getAll(): ConnectedClient[] {
    return Array.from(this.clients.values());
  }

  public getPrimary(): ConnectedClient | null {
    const all = this.getAll();
    return all.length === 1 ? all[0]! : (all.find((c) => c.browserFamily === "chrome") ?? all[0] ?? null);
  }

  public touch(ws: ServerWebSocket<unknown>): void {
    for (const client of this.clients.values()) {
      if (client.ws === ws) client.lastHeartbeat = Date.now();
    }
  }

  public evictStale(ttlMs: number, now = Date.now()): ConnectedClient[] {
    const evicted: ConnectedClient[] = [];
    for (const [installId, client] of this.clients.entries()) {
      if (now - client.lastHeartbeat > ttlMs) {
        this.clients.delete(installId);
        evicted.push(client);
      }
    }
    return evicted;
  }

  /**
   * A compound id is authoritative. A bare id is accepted only when there is
   * exactly one client; with several clients it used to fall back to the
   * primary, which silently drove the wrong browser.
   */
  public findClientForTarget(targetId: string): { client: ConnectedClient; rawTabId: string } | null {
    const compound = parseCompoundTargetId(targetId);
    if (compound) {
      const client = this.getAll().find((candidate) => candidate.clientId === compound.clientId);
      if (!client) return null;
      // Once a client has reported its tabs, a target that is no longer in that
      // list was closed; do not route to a stale id.
      if (client.tabsReported && !client.tabs.some((tab) => tab.targetId === targetId)) return null;
      return { client, rawTabId: String(compound.tabId) };
    }

    const all = this.getAll();
    if (all.length === 1) return { client: all[0]!, rawTabId: targetId };
    if (all.length > 1) return null;
    return null;
  }

  public health(): ClientHealth[] {
    return this.getAll().map((client) => ({
      clientId: client.clientId,
      installationProfileId: client.installationProfileId,
      connectionId: client.connectionId,
      browserFamily: client.browserFamily,
      profileLabel: client.profileLabel,
      extensionVersion: client.extensionVersion,
      tabCount: client.tabs.length,
      lastHeartbeat: client.lastHeartbeat,
    }));
  }
}

export function mapClientTabs(
  rawList: readonly Record<string, unknown>[],
  client: ConnectedClient,
  multiClient: boolean,
): TabDescriptor[] {
  return rawList.map((tab) => {
    const nativeId = Number(tab.tabId ?? tab.targetId);
    return {
      targetId: multiClient ? `${client.clientId}::${nativeId}` : String(nativeId),
      title: `${multiClient ? `[${client.profileLabel || client.browserFamily}] ` : ""}${String(tab.title || "Untitled Tab")}`,
      url: String(tab.url || "about:blank"),
    };
  });
}
