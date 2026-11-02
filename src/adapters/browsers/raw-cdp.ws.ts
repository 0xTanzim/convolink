import { BrowserConnectionError } from "../../core/errors/bridge-errors.js";
import type { PendingMessage } from "./raw-cdp.types.js";

export async function createCdpSocket(
  webSocketUrl: string,
  targetId: string,
  host: string,
  port: number,
  pending: Map<number, PendingMessage>,
): Promise<WebSocket> {
  const ws = new WebSocket(webSocketUrl);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("WebSocket handshake timed out")), 5000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = (e) => { clearTimeout(timer); reject(new Error(`WebSocket error on tab ${targetId}: ${e}`)); };
  });

  const cleanup = (reason: string) => {
    for (const req of pending.values()) {
      req.reject(new BrowserConnectionError(`${host}:${port}`, `Tab ${targetId} closed: ${reason}`));
    }
    pending.clear();
  };

  ws.onclose = () => cleanup("connection closed");
  ws.onerror = (e) => cleanup(String(e));
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data.toString());
      if (msg.id && pending.has(msg.id)) {
        const handler = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) handler.reject(new Error(msg.error.message || "CDP error"));
        else handler.resolve(msg.result);
      }
    } catch {}
  };

  return ws;
}
