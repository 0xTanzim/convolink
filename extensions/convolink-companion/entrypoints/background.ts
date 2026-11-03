import { PLATFORM_SELECTORS, platformForUrl, type PlatformKey } from "./platforms.js";
import { TabOwnership } from "../../../src/core/services/tab-ownership.js";
import {
  bodyIncludesOp,
  clickOp,
  focusOp,
  reloadOp,
  startNewChatOp,
  fillTextOp,
  getTextOp,
  getUrlOp,
  pressKeyOp,
  probeComposerTextOp,
  probeMountedOp,
  probeQuietOp,
  probeReadyOp,
  probeSelectorsOp,
  readThreadOp,
  statusOp,
} from "./operations.js";

type JsonRecord = Record<string, unknown>;

interface ExtensionTab {
  id?: number;
  url?: string;
  title?: string;
  windowId?: number;
  active?: boolean;
}

interface ExtensionApi {
  runtime: {
    getManifest(): { version: string };
    onStartup: { addListener(listener: () => void): void };
    onInstalled: { addListener(listener: () => void): void };
    onMessage: { addListener(listener: (message: JsonRecord, sender: unknown, respond: (value: unknown) => void) => boolean | void): void };
  };
  storage: {
    local: { get(keys?: string[]): Promise<JsonRecord>; set(values: JsonRecord): Promise<void> };
    session?: { get(keys?: string[]): Promise<JsonRecord>; set(values: JsonRecord): Promise<void> };
  };
  alarms: {
    create(name: string, info: { delayInMinutes?: number; periodInMinutes?: number }): void;
    onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
  };
  tabs: {
    query(query: JsonRecord): Promise<ExtensionTab[]>;
    create(options: JsonRecord): Promise<ExtensionTab>;
    remove(tabId: number): Promise<void>;
    update(tabId: number, options: JsonRecord): Promise<ExtensionTab>;
    onRemoved: { addListener(listener: (tabId: number) => void): void };
  };
  scripting: {
    executeScript<T>(options: JsonRecord): Promise<Array<{ result?: T }>>;
  };
}

const globalScope = globalThis as unknown as { browser?: ExtensionApi; chrome?: ExtensionApi };
const api = (globalScope.browser ?? globalScope.chrome) as ExtensionApi;

const BRIDGE_URL = "ws://127.0.0.1:9224";
const PROTOCOL_VERSION = 2;
const HEARTBEAT_MS = 15_000;
const MAX_MISSED_ACKS = 2;
const MAX_BACKOFF_MS = 30_000;
const COMMAND_TIMEOUT_MS = 12_000;
const AI_DOMAINS = ["chatgpt.com", "chat.openai.com", "chat.deepseek.com", "gemini.google.com", "claude.ai"];
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
let connected = false;
let ownership = new TabOwnership();

async function loadOwnedTabs(): Promise<void> {
  const data = await api.storage.local.get(["ownedTabs"]);
  ownership = TabOwnership.from(data.ownedTabs);
}

async function saveOwnedTabs(): Promise<void> {
  await api.storage.local.set({ ownedTabs: ownership.ids() });
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

async function handleCommand(message: JsonRecord & { id: number; type: string }): Promise<void> {
  const { id, type } = message;
  const targetId = Number(message.targetId);
  const platform = typeof message.platform === "string" ? (message.platform as PlatformKey) : null;
  const selectors = platform ? PLATFORM_SELECTORS[platform] : null;

  try {
    switch (type) {
      case "PING": {
        sendResult(id, { pong: true, version: api.runtime.getManifest().version, protocol: PROTOCOL_VERSION });
        return;
      }
      case "LIST_TABS": {
        const tabs = await api.tabs.query({});
        await loadOwnedTabs();
        const list = tabs
          .filter((tab) => tab.id !== undefined && tab.url && AI_DOMAINS.some((domain) => tab.url!.includes(domain)))
          .map((tab) => ({
            tabId: tab.id,
            title: tab.title || "Untitled AI Tab",
            url: tab.url,
            windowId: tab.windowId,
            active: Boolean(tab.active),
            owned: ownership.has(Number(tab.id)),
            platform: platformForUrl(tab.url || ""),
          }));
        sendResult(id, list);
        return;
      }
      case "GET_URL":
        sendResult(id, await runInTab(targetId, getUrlOp, []));
        return;
      case "GET_TEXT":
        sendResult(id, await runInTab(targetId, getTextOp, [String(message.selector)]));
        return;
      case "GET_BODY_INCLUDES":
        sendResult(id, await runInTab(targetId, bodyIncludesOp, [String(message.text)]));
        return;
      case "PROBE_SELECTORS":
        if (!selectors) throw new Error(`Unknown platform: ${String(platform)}`);
        sendResult(id, await runInTab(targetId, probeSelectorsOp, [selectors]));
        return;
      case "PROBE_MOUNTED":
        sendResult(id, await runInTab(targetId, probeMountedOp, [String(message.composer)]));
        return;
      case "PROBE_READY":
        sendResult(id, await runInTab(targetId, probeReadyOp, [String(message.composer), String(message.send)]));
        return;
      case "PROBE_QUIET":
        sendResult(id, await runInTab(targetId, probeQuietOp, []));
        return;
      case "PROBE_COMPOSER_TEXT":
        sendResult(id, await runInTab(targetId, probeComposerTextOp, [String(message.selector)]));
        return;
      case "READ_THREAD": {
        if (!selectors) throw new Error(`Unknown platform: ${String(platform)}`);
        sendResult(id, await runInTab(targetId, readThreadOp, [selectors, Number(message.lastN) || 20]));
        return;
      }
      case "PROBE_STATUS": {
        if (!selectors) throw new Error(`Unknown platform: ${String(platform)}`);
        sendResult(id, await runInTab(targetId, statusOp, [selectors, Number(message.beforeTurnCount) || 0]));
        return;
      }
      case "FOCUS": {
        const focused = await runInTab(targetId, focusOp, [String(message.selector)]);
        sendResult(id, focused);
        return;
      }
      case "RELOAD": {
        await runInTab(targetId, reloadOp, []);
        sendResult(id, { ok: true });
        return;
      }
      case "PROBE_CONTINUATION":
        sendResult(id, { hasContinuation: false, triggerSelector: null });
        return;
      case "PROBE_DOWNLOADS":
        sendResult(id, []);
        return;
      case "INSPECT_CANVAS":
        sendResult(id, null);
        return;
      case "START_NEW_CHAT": {
        const result = await runInTab(targetId, startNewChatOp, [String(message.baseUrl || "")]);
        sendResult(id, result);
        return;
      }
      case "FILL_TEXT": {
        const result = await runInTab(targetId, fillTextOp, [String(message.selector), String(message.text)]);
        if (!result?.ok) sendError(id, "not-ready", result?.error || "Composer did not accept the text", true);
        else sendResult(id, result);
        return;
      }
      case "CLICK":
        sendResult(id, await runInTab(targetId, clickOp, [String(message.selector)]));
        return;
      case "PRESS_KEY":
        sendResult(id, await runInTab(targetId, pressKeyOp, [String(message.selector), String(message.key)]));
        return;
      case "CREATE_TAB": {
        const tab = await api.tabs.create({ url: String(message.url), active: false });
        if (tab.id !== undefined) {
          ownership.add(tab.id);
          await saveOwnedTabs();
        }
        sendResult(id, { tabId: tab.id, title: tab.title || "", url: tab.url || String(message.url), owned: true });
        return;
      }
      case "CLOSE_TAB": {
        await loadOwnedTabs();
        if (!ownership.canClose(targetId, message.force === true)) {
          sendError(id, "not-owned", `Tab ${targetId} was not opened by ConvoLink`, false);
          return;
        }
        await api.tabs.remove(targetId);
        ownership.remove(targetId);
        await saveOwnedTabs();
        sendResult(id, { closed: true });
        return;
      }
      case "BRING_TO_FRONT": {
        await api.tabs.update(targetId, { active: true });
        sendResult(id, { active: true });
        return;
      }
      case "NAVIGATE":
        await api.tabs.update(targetId, { url: String(message.url) });
        sendResult(id, { ok: true });
        return;
      default:
        sendError(id, "unsupported", `Unknown command: ${type}`, false);
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    const code = messageText.includes("not found") ? "tab-not-found" : messageText.includes("timed out") ? "timeout" : "internal";
    sendError(id, code, messageText, code === "timeout");
  }
}

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
          await handleCommand(message as JsonRecord & { id: number; type: string });
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
    try { socket?.close(); } catch {}
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
