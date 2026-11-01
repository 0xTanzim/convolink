import type { ServerWebSocket } from "bun";
import type { TabDescriptor } from "../../core/ports/browser.port.js";
import type { BrowserFamily, ClientHandshake } from "../../core/ports/extension-protocol.js";

export interface ConnectedClient {
  readonly ws: ServerWebSocket<unknown>;
  readonly clientId: string;
  readonly installationProfileId: string;
  readonly connectionId: string;
  readonly serverGeneration: number;
  readonly browserFamily: BrowserFamily;
  readonly profileLabel: string;
  readonly extensionVersion: string;
  readonly lastHeartbeat: number;
  tabs: TabDescriptor[];
}

export class ClientRegistry {
  private readonly clients = new Map<string, ConnectedClient>();
  private generationCounter = 0;

  public register(ws: ServerWebSocket<unknown>, handshake: Partial<ClientHandshake> & { type?: string }): ConnectedClient {
    const installId = handshake.installationProfileId || handshake.clientId || `client-${Date.now()}`;
    const generation = ++this.generationCounter;

    const client: ConnectedClient = {
      ws,
      clientId: handshake.clientId || installId,
      installationProfileId: installId,
      connectionId: handshake.connectionId || `conn-${Date.now()}`,
      serverGeneration: generation,
      browserFamily: handshake.browserFamily || "chrome",
      profileLabel: handshake.profileLabel || "Default",
      extensionVersion: handshake.extensionVersion || "1.0.0",
      lastHeartbeat: Date.now(),
      tabs: [],
    };

    this.clients.set(installId, client);
    return client;
  }

  public removeBySocket(ws: ServerWebSocket<unknown>): ConnectedClient | null {
    for (const [installId, client] of this.clients.entries()) {
      if (client.ws === ws) {
        // Socket-guarded close: only delete if the socket is still the active one
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
    if (all.length === 0) return null;
    return all.find((c) => c.browserFamily === "chrome") ?? all[0] ?? null;
  }

  public findClientForTarget(targetId: string): { client: ConnectedClient; rawTabId: string } | null {
    for (const client of this.clients.values()) {
      const found = client.tabs.find((t) => t.targetId === targetId);
      if (found) {
        return { client, rawTabId: targetId.split("::").pop() || targetId };
      }
    }
    const primary = this.getPrimary();
    if (primary) {
      return { client: primary, rawTabId: targetId };
    }
    return null;
  }
}
