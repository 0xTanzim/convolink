import { TabOwnership } from "../../../src/core/services/tab-ownership.js";
import { resolveExtensionApi, type ExtensionApi, type JsonRecord } from "./extension-api.js";
import { handleCommand, type RouterContext } from "./router.js";

interface BuildMeta {
  version?: string;
  buildId?: string;
  builtAt?: string;
}

const api: ExtensionApi = resolveExtensionApi();

const BRIDGE_URL = "ws://127.0.0.1:9224";
const PROTOCOL_VERSION = 2;
const HEARTBEAT_MS = 15_000;
const MAX_MISSED_ACKS = 2;
const MAX_BACKOFF_MS = 30_000;
const COMMAND_TIMEOUT_MS = 25_000;
const RECONNECT_ALARM = "convolink-reconnect";

let socket: WebSocket | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let backoffMs = 1_000;
let missedAcks = 0;
let clientId = "";
let installationProfileId = "";
let browserFamily = "chrome";
let profileLabel = "Personal";
let bridgeToken = "";
let buildId = "dev";
let connected = false;
let ownership = new TabOwnership();

async function loadOwnedTabs(): Promise<void> {
  const data = await api.storage.local.get(["ownedTabs"]);
  ownership = TabOwnership.from(data.ownedTabs);
}

async function saveOwnedTabs(): Promise<void> {
  await api.storage.local.set({ ownedTabs: ownership.ids() });
}

async function loadBuildMeta(): Promise<void> {
  try {
    const response = await fetch(api.runtime.getURL("build-meta.json"));
    if (!response.ok) return;
    const meta = (await response.json()) as BuildMeta;
    buildId = meta.buildId ? String(meta.buildId) : "unknown";
  } catch {
    // A missing meta file must never block the bridge.
  }
}

async function initIdentity(): Promise<void> {
  const data = await api.storage.local.get(["installationProfileId", "profileLabel", "bridgeToken"]);
  if (typeof data.installationProfileId === "string" && data.installationProfileId) {
    installationProfileId = data.installationProfileId;
  } else {
    installationProfileId = `prof-${crypto.randomUUID()}`;
    await api.storage.local.set({ installationProfileId });
  }
  clientId = installationProfileId;
  profileLabel = typeof data.profileLabel === "string" && data.profileLabel ? data.profileLabel : "Personal";
  bridgeToken = typeof data.bridgeToken === "string" ? data.bridgeToken : "";
  await loadBuildMeta();

  const ua = navigator.userAgent.toLowerCase();
  const brave = (navigator as unknown as { brave?: unknown }).brave;
  if (ua.includes("brave") || brave) browserFamily = "brave";
  else if (ua.includes("edg/")) browserFamily = "edge";
  else if (ua.includes("firefox")) browserFamily = "firefox";
  else browserFamily = "chrome";
}

function send(message: JsonRecord): void {
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

function sendResult(id: number, result: unknown): void {
  send({ v: PROTOCOL_VERSION, id, ok: true, result });
}

function sendError(id: number, code: string, message: string, retryable = false): void {
  send({ v: PROTOCOL_VERSION, id, ok: false, error: { code, message, retryable } });
}

async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${COMMAND_TIMEOUT_MS}ms`)), COMMAND_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function runInTab<T>(tabId: number, func: (...args: never[]) => T, args: unknown[]): Promise<T> {
  const results = await withTimeout(
    api.scripting.executeScript<T>({ target: { tabId }, func, args }),
    `executeScript(${func.name || "anonymous"})`,
  );
  return results[0]?.result as T;
}

const routerContext: RouterContext = {
  api,
  ownership: {
    has: (tabId) => ownership.has(tabId),
    add: (tabId) => ownership.add(tabId),
    remove: (tabId) => ownership.remove(tabId),
    canClose: (tabId, force) => ownership.canClose(tabId, force),
  },
  loadOwnedTabs,
  saveOwnedTabs,
  runInTab,
  sendResult,
  sendError,
  buildId,
};

function scheduleReconnect(): void {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, backoffMs);
  backoffMs = Math.min(MAX_BACKOFF_MS, backoffMs * 2);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function connect(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;

  try {
    socket = new WebSocket(BRIDGE_URL);

    socket.onopen = async () => {
      if (!installationProfileId) await initIdentity();
      missedAcks = 0;
      backoffMs = 1_000;
      send({
        type: "HANDSHAKE",
        protocolVersion: PROTOCOL_VERSION,
        clientId,
        installationProfileId,
        connectionId: `conn-${crypto.randomUUID()}`,
        browserFamily,
        profileLabel,
        extensionVersion: api.runtime.getManifest().version,
        buildId,
        token: bridgeToken,
      });
    };

    socket.onmessage = async (event) => {
      try {
        const message = JSON.parse(String(event.data)) as JsonRecord;
        if (message.type === "HANDSHAKE_ACK") {
          if (message.success === true) {
            connected = true;
            await api.storage.local.set({ connectionStatus: "connected", lastError: null });
            stopHeartbeat();
            heartbeatTimer = setInterval(() => {
              if (missedAcks >= MAX_MISSED_ACKS) {
                socket?.close();
                return;
              }
              missedAcks += 1;
              send({ type: "HEARTBEAT", timestamp: Date.now() });
            }, HEARTBEAT_MS);
          } else {
            connected = false;
            await api.storage.local.set({ connectionStatus: "unauthorized", lastError: message.error ?? "Handshake rejected" });
            socket?.close();
          }
          return;
        }
        if (message.type === "HEARTBEAT_ACK") {
          missedAcks = 0;
          return;
        }
        if (typeof message.id === "number" && typeof message.type === "string") {
          await handleCommand(message as JsonRecord & { id: number; type: string }, { ...routerContext, buildId });
        }
      } catch {
        // A malformed frame must not tear down a healthy socket.
      }
    };

    socket.onclose = async () => {
      socket = null;
      connected = false;
      stopHeartbeat();
      await api.storage.local.set({ connectionStatus: "disconnected" });
      scheduleReconnect();
    };

    socket.onerror = () => {
      socket?.close();
    };
  } catch {
    scheduleReconnect();
  }
}

api.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RECONNECT_ALARM) connect();
});
api.runtime.onStartup.addListener(() => connect());
api.runtime.onInstalled.addListener(() => connect());
api.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.type === "RECONNECT") {
    try {
      socket?.close();
    } catch {}
    socket = null;
    backoffMs = 1_000;
    void initIdentity().then(() => connect());
    respond({ ok: true });
    return true;
  }
  return false;
});
api.tabs.onRemoved.addListener((tabId) => {
  if (connected) send({ v: PROTOCOL_VERSION, event: "TAB_REMOVED", targetId: String(tabId) });
});

api.alarms.create(RECONNECT_ALARM, { periodInMinutes: 0.5 });
initIdentity().then(() => connect());
