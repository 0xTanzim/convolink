export default defineBackground(() => {
  const BRIDGE_WS_URL = "ws://127.0.0.1:9224";
  const AI_DOMAINS = [
    "chatgpt.com",
    "chat.deepseek.com",
    "gemini.google.com",
    "claude.ai",
  ];

  let ws: WebSocket | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let installationProfileId = "";
  let clientId = "";
  let browserFamily = "chrome";
  let profileLabel = "Personal";

  // Top-level listener registration for alarms recovery
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "convolink-reconnect") {
      connectToBridge();
    }
  });

  async function initIdentity(): Promise<void> {
    const data = await chrome.storage.local.get(["installationProfileId", "profileLabel"]);
    if (data.installationProfileId) {
      installationProfileId = data.installationProfileId as string;
    } else {
      installationProfileId = `prof-${crypto.randomUUID()}`;
      await chrome.storage.local.set({ installationProfileId });
    }
    clientId = installationProfileId;
    profileLabel = (data.profileLabel as string) || "Personal";

    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("brave") || (navigator as any).brave) {
      browserFamily = "brave";
    } else if (ua.includes("edg/")) {
      browserFamily = "edge";
    } else if (ua.includes("firefox")) {
      browserFamily = "firefox";
    } else {
      browserFamily = "chrome";
    }
  }

  function connectToBridge(): void {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    try {
      ws = new WebSocket(BRIDGE_WS_URL);

      ws.onopen = async () => {
        if (!installationProfileId) await initIdentity();
        const connectionId = `conn-${crypto.randomUUID()}`;

        ws?.send(
          JSON.stringify({
            type: "HANDSHAKE",
            protocolVersion: 1,
            clientId,
            installationProfileId,
            connectionId,
            browserFamily,
            profileLabel,
            extensionVersion: "1.0.0",
          }),
        );

        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "HEARTBEAT", timestamp: Date.now() }));
          }
        }, 20000);
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          await handleMessage(msg);
        } catch {}
      };

      ws.onclose = () => {
        ws = null;
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws = null;
      };
    } catch {
      scheduleReconnect();
    }
  }

  function scheduleReconnect(): void {
    chrome.alarms.create("convolink-reconnect", { delayInMinutes: 0.5 });
  }

  async function handleMessage(msg: { id: number; type: string; [key: string]: any }): Promise<void> {
    const { id, type } = msg;

    if (type === "LIST_TABS") {
      const tabs = await chrome.tabs.query({});
      const aiTabs = tabs
        .filter((t) => t.url && AI_DOMAINS.some((d) => t.url!.includes(d)))
        .map((t) => ({
          tabId: t.id,
          title: t.title || "Untitled AI Tab",
          url: t.url,
        }));
      sendResult(id, aiTabs);
      return;
    }

    if (type === "BRING_TO_FRONT") {
      const tabId = parseInt(String(msg.targetId), 10);
      await chrome.tabs.update(tabId, { active: true });
      sendResult(id, { active: true });
      return;
    }
  }

  function sendResult(id: number, result: any): void {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id, result }));
    }
  }

  initIdentity().then(() => connectToBridge());
});
