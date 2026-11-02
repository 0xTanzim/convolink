/**
 * Low-level WebSocket connection management and BiDi session negotiation for Firefox.
 */

import { STEALTH_PRELOAD_SCRIPT } from "../common/stealth-scripts.js";
import { ConvoError } from "../../core/errors/convo-error.js";

export async function createBidiSocket(
  port: number,
  pending: Map<number, { resolve: (val: any) => void; reject: (err: Error) => void }>,
  sendRaw: (ws: WebSocket, method: string, params: Record<string, unknown>) => Promise<any>,
): Promise<WebSocket> {
  const wsUrl = `ws://127.0.0.1:${port}/session`;
  const ws = new WebSocket(wsUrl);

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("BiDi WebSocket timeout")), 5000);
    ws.onopen = () => { clearTimeout(timeout); resolve(); };
    ws.onerror = (err) => { clearTimeout(timeout); reject(err); };
    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data.toString());
        const handler = pending.get(data.id);
        if (handler) {
          pending.delete(data.id);
          if (data.type === "error") handler.reject(new Error(data.message));
          else handler.resolve(data.result);
        }
      } catch {}
    };
  });

  // Automatically negotiate WebDriver BiDi session upon initial connection
  try {
    await sendRaw(ws, "session.new", { capabilities: {} });
  } catch (err: unknown) {
    const msg = (err as Error)?.message || "";
    if (msg.includes("Maximum number of active sessions")) {
      throw new ConvoError(
        "session-busy",
        "Firefox already has an active BiDi session held by another client.",
        "Close the other ConvoLink process, or run `convo connect --firefox --restart` to reopen the same profile.",
        { cause: err },
      );
    }
    throw err;
  }

  // Inject comprehensive stealth preload script across all browsing contexts
  try {
    await sendRaw(ws, "script.addPreloadScript", {
      functionDeclaration: `() => { ${STEALTH_PRELOAD_SCRIPT} }`,
    });
  } catch {}

  return ws;
}
