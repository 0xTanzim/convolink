// extensions/convolink-companion/entrypoints/background.ts
var defineBackground = (fn) => fn();
var background_default = defineBackground(() => {
  const BRIDGE_WS_URL = "ws://127.0.0.1:9224";
  const AI_DOMAINS = [
    "chatgpt.com",
    "chat.deepseek.com",
    "gemini.google.com",
    "claude.ai"
  ];
  let ws = null;
  let heartbeatTimer = null;
  let installationProfileId = "";
  let clientId = "";
  let browserFamily = "chrome";
  let profileLabel = "Personal";
  let bridgeToken = "";
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "convolink-reconnect") {
      connectToBridge();
    }
  });
  async function initIdentity() {
    const data = await chrome.storage.local.get(["installationProfileId", "profileLabel", "bridgeToken"]);
    if (data.installationProfileId) {
      installationProfileId = data.installationProfileId;
    } else {
      installationProfileId = `prof-${crypto.randomUUID()}`;
      await chrome.storage.local.set({ installationProfileId });
    }
    clientId = installationProfileId;
    profileLabel = data.profileLabel || "Personal";
    bridgeToken = data.bridgeToken || "";
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("brave") || navigator.brave) {
      browserFamily = "brave";
    } else if (ua.includes("edg/")) {
      browserFamily = "edge";
    } else if (ua.includes("firefox")) {
      browserFamily = "firefox";
    } else {
      browserFamily = "chrome";
    }
  }
  function connectToBridge() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    try {
      ws = new WebSocket(BRIDGE_WS_URL);
      ws.onopen = async () => {
        if (!installationProfileId)
          await initIdentity();
        const connectionId = `conn-${crypto.randomUUID()}`;
        ws?.send(JSON.stringify({
          type: "HANDSHAKE",
          protocolVersion: 1,
          clientId,
          installationProfileId,
          connectionId,
          browserFamily,
          profileLabel,
          extensionVersion: "1.0.0",
          token: bridgeToken
        }));
        if (heartbeatTimer)
          clearInterval(heartbeatTimer);
        heartbeatTimer = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "HEARTBEAT", timestamp: Date.now() }));
          }
        }, 20000);
      };
      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "HANDSHAKE_ACK") {
            if (msg.success) {
              await chrome.storage.local.set({ connectionStatus: "connected", lastError: null });
            } else {
              await chrome.storage.local.set({ connectionStatus: "unauthorized", lastError: msg.error });
            }
            return;
          }
          await handleMessage(msg);
        } catch {}
      };
      ws.onclose = async () => {
        ws = null;
        if (heartbeatTimer)
          clearInterval(heartbeatTimer);
        await chrome.storage.local.set({ connectionStatus: "disconnected" });
        scheduleReconnect();
      };
      ws.onerror = async () => {
        ws = null;
        await chrome.storage.local.set({ connectionStatus: "disconnected" });
      };
    } catch {
      scheduleReconnect();
    }
  }
  function scheduleReconnect() {
    chrome.alarms.create("convolink-reconnect", { delayInMinutes: 0.5 });
  }
  async function handleMessage(msg) {
    const { id, type } = msg;
    if (type === "LIST_TABS") {
      const tabs = await chrome.tabs.query({});
      const aiTabs = tabs.filter((t) => t.url && AI_DOMAINS.some((d) => t.url.includes(d))).map((t) => ({
        tabId: t.id,
        title: t.title || "Untitled AI Tab",
        url: t.url
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
    if (type === "ATTACH" || type === "DETACH") {
      sendResult(id, { ok: true });
      return;
    }
    if (type === "CREATE_TAB") {
      const newTab = await chrome.tabs.create({ url: msg.url });
      sendResult(id, { targetId: String(newTab.id), title: newTab.title || "", url: newTab.url || msg.url });
      return;
    }
    if (type === "CLOSE_TAB") {
      const tabId = parseInt(String(msg.targetId), 10);
      await chrome.tabs.remove(tabId);
      sendResult(id, { ok: true });
      return;
    }
    if (type === "NAVIGATE") {
      const tabId = parseInt(String(msg.targetId), 10);
      await chrome.tabs.update(tabId, { url: msg.url });
      sendResult(id, { ok: true });
      return;
    }
    if (type === "EVALUATE") {
      const tabId = parseInt(String(msg.targetId), 10);
      try {
        const results = await chrome.scripting.executeScript({
          target: { tabId },
          func: (code) => {
            try {
              const res = (0, eval)(code);
              return { ok: true, value: res };
            } catch (err) {
              return { ok: false, error: String(err?.message || err) };
            }
          },
          args: [msg.expression]
        });
        const first = results?.[0]?.result;
        if (!first) {
          sendError(id, "No execution result from tab");
        } else if (first.ok) {
          sendResult(id, { value: first.value });
        } else {
          sendError(id, first.error || "Evaluation failed in page");
        }
      } catch (err) {
        sendError(id, err.message || "Failed to executeScript on target tab");
      }
      return;
    }
    if (type === "FILL_TEXT") {
      const tabId = parseInt(String(msg.targetId), 10);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (selector, text) => {
            const el = document.querySelector(selector);
            if (!el)
              throw new Error(`Element not found for selector: ${selector}`);
            el.scrollIntoView({ block: "center", inline: "nearest" });
            el.focus();
            if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
              const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
              const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
              if (setter)
                setter.call(el, text);
              else
                el.value = text;
              el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
              el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
            } else if (el.isContentEditable || el.getAttribute("contenteditable") === "true") {
              el.textContent = text;
              el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
            } else {
              el.value = text;
              el.dispatchEvent(new Event("input", { bubbles: true }));
            }
          },
          args: [msg.selector, msg.text]
        });
        sendResult(id, { ok: true });
      } catch (err) {
        sendError(id, err.message || "FILL_TEXT failed");
      }
      return;
    }
    if (type === "CLICK") {
      const tabId = parseInt(String(msg.targetId), 10);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (selector) => {
            const el = document.querySelector(selector);
            if (!el)
              throw new Error(`Element not found for selector: ${selector}`);
            el.scrollIntoView({ block: "center", inline: "nearest" });
            const rect = el.getBoundingClientRect();
            const opts = { bubbles: true, cancelable: true, view: window, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
            el.dispatchEvent(new MouseEvent("mousedown", opts));
            el.dispatchEvent(new MouseEvent("mouseup", opts));
            el.dispatchEvent(new MouseEvent("click", opts));
            if (typeof el.click === "function")
              el.click();
          },
          args: [msg.selector]
        });
        sendResult(id, { ok: true });
      } catch (err) {
        sendError(id, err.message || "CLICK failed");
      }
      return;
    }
    if (type === "PRESS_KEY") {
      const tabId = parseInt(String(msg.targetId), 10);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (selector, key) => {
            const el = document.querySelector(selector) || document.activeElement || document.body;
            const keyCode = key === "Enter" ? 13 : 0;
            const opts = { key, code: key === "Enter" ? "Enter" : key, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true };
            el.dispatchEvent(new KeyboardEvent("keydown", opts));
            el.dispatchEvent(new KeyboardEvent("keypress", opts));
            el.dispatchEvent(new KeyboardEvent("keyup", opts));
          },
          args: [msg.selector, msg.key]
        });
        sendResult(id, { ok: true });
      } catch (err) {
        sendError(id, err.message || "PRESS_KEY failed");
      }
      return;
    }
  }
  function sendResult(id, result) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id, result }));
    }
  }
  function sendError(id, error) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ id, error }));
    }
  }
  initIdentity().then(() => connectToBridge());
});
export {
  background_default as default
};
