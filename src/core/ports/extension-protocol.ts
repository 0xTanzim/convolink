export type BrowserFamily = "chrome" | "brave" | "edge" | "firefox";

export interface ClientHandshake {
  protocolVersion: 1;
  clientId: string; // Stable installation identity
  installationProfileId: string;
  connectionId: string; // Fresh random UUID per connection
  browserFamily: BrowserFamily;
  profileLabel: string;
  extensionVersion: string;
  token?: string;
}

export interface HandshakeAck {
  success: boolean;
  serverGeneration: number;
  error?: string;
}

export interface BrowserTarget {
  targetId: string; // Opaque live target ID
  clientId: string; // Owning extension installation
  connectionId: string; // Owning connection session
  tabId: number; // Browser-scoped tab ID
  url: string;
  title: string;
  browserFamily: BrowserFamily;
  profileLabel: string;
}

export interface DiscoveredExtensionTab {
  tabId: number;
  url: string;
  title: string;
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
