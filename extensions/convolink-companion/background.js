// ConvoLink Companion — Background Service Worker
const BRIDGE_WS_URL = "ws://127.0.0.1:9224";
let ws = null;
let reconnectTimer = null;

const AI_DOMAINS = [
  "chatgpt.com",
  "chat.deepseek.com",
  "gemini.google.com",
  "claude.ai",
];

function connectToBridge() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    ws = new WebSocket(BRIDGE_WS_URL);

    ws.onopen = () => {
      console.log("[ConvoLink] Connected to local ConvoLink bridge.");
      if (reconnectTimer) {
        clearInterval(reconnectTimer);
        reconnectTimer = null;
      }
      ws.send(JSON.stringify({
        type: "HANDSHAKE",
        extensionVersion: "1.0.0",
        profileName: "Chrome Everyday Profile",
      }));
    };

    ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await handleBridgeMessage(msg);
      } catch (err) {
        console.error("[ConvoLink] Error processing bridge message:", err);
      }
    };

    ws.onclose = () => {
      ws = null;
      scheduleReconnect();
    };

    ws.onerror = () => {
      ws = null;
    };
  } catch (err) {
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (!reconnectTimer) {
    reconnectTimer = setInterval(connectToBridge, 3000);
  }
}

async function handleBridgeMessage(msg) {
  const { id, type } = msg;

  if (type === "LIST_TABS") {
    const tabs = await chrome.tabs.query({});
    const aiTabs = tabs
      .filter((t) => t.url && AI_DOMAINS.some((d) => t.url.includes(d)))
      .map((t) => ({
        targetId: String(t.id),
        title: t.title || "Untitled",
        url: t.url,
      }));
    sendResult(id, aiTabs);
    return;
  }

  if (type === "ATTACH") {
    const tabId = parseInt(msg.targetId, 10);
    await chrome.debugger.attach({ tabId }, "1.3");
    sendResult(id, { attached: true });
    return;
  }

  if (type === "DETACH") {
    const tabId = parseInt(msg.targetId, 10);
    await chrome.debugger.detach({ tabId });
    sendResult(id, { detached: true });
    return;
  }

  if (type === "BRING_TO_FRONT") {
    const tabId = parseInt(msg.targetId, 10);
    await chrome.tabs.update(tabId, { active: true });
    sendResult(id, { active: true });
    return;
  }

  if (type === "EVALUATE") {
    const tabId = parseInt(msg.targetId, 10);
    const res = await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      expression: msg.expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (res.exceptionDetails) {
      sendError(id, res.exceptionDetails.text || "Evaluation error");
    } else {
      sendResult(id, { value: res.result?.value });
    }
    return;
  }

  if (type === "FILL_TEXT") {
    const tabId = parseInt(msg.targetId, 10);
    await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(msg.selector)}); if (el) el.focus(); })()`,
    });
    await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text: msg.text });
    sendResult(id, { ok: true });
    return;
  }

  if (type === "CLICK") {
    const tabId = parseInt(msg.targetId, 10);
    await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(msg.selector)}); if (el) el.click(); })()`,
    });
    sendResult(id, { ok: true });
    return;
  }

  if (type === "PRESS_KEY") {
    const tabId = parseInt(msg.targetId, 10);
    const key = msg.key;
    const expr = `(() => { const el = document.querySelector(${JSON.stringify(msg.selector)}); if (el) { el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true })); } })()`;
    await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", { expression: expr });
    sendResult(id, { ok: true });
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
    ws.send(JSON.stringify({ id, error: String(error) }));
  }
}

connectToBridge();
