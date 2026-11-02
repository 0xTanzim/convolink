/**
 * Low-level WebSocket connection management and BiDi session negotiation for Firefox.
 */

import { STEALTH_PRELOAD_SCRIPT } from "../common/stealth-scripts.js";

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
      console.error(`\n⚠️ Firefox WebDriver BiDi already has an active session from a previous process.`);
      console.error(`💡 Firefox requires a quick restart to clear the stale session:`);
      console.error(`   Run 'convo clean' or restart Firefox with: firefox -no-remote --remote-debugging-port=${port}\n`);
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
