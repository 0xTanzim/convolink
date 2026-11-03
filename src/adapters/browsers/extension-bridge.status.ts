export interface ExtensionClientStatus {
  readonly clientId: string;
  readonly installationProfileId?: string;
  readonly connectionId?: string;
  readonly browserFamily: string;
  readonly profileLabel: string;
  readonly extensionVersion: string;
  readonly tabCount: number;
  readonly lastHeartbeat: number;
}

export interface ExtensionBridgeStatus {
  readonly running: boolean;
  readonly endpoint: string;
  readonly clients: readonly ExtensionClientStatus[];
  readonly error?: string;
}

const DEFAULT_PORT = 9224;
const STATUS_TIMEOUT_MS = 800;

export async function fetchExtensionBridgeStatus(
  port = DEFAULT_PORT,
  timeoutMs = STATUS_TIMEOUT_MS,
): Promise<ExtensionBridgeStatus> {
  const endpoint = `http://127.0.0.1:${port}/status`;
  try {
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) {
      return { running: true, endpoint, clients: [], error: `status returned ${response.status}` };
    }
    const body = (await response.json()) as { clients?: ExtensionClientStatus[] };
    return { running: true, endpoint, clients: Array.isArray(body.clients) ? body.clients : [] };
  } catch (error) {
    return {
      running: false,
      endpoint,
      clients: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
