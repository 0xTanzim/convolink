import type { TabDescriptor } from "../../core/ports/browser.port.js";
import type { CdpTarget } from "./raw-cdp.types.js";

/**
 * Queries CDP targets from /json/list and standardizes WebSocket debugger URLs.
 */
export async function queryCdpTargets(host: string, port: number): Promise<TabDescriptor[]> {
  const res = await fetch(`http://${host}:${port}/json/list`);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  const rawTargets = (await res.json()) as CdpTarget[];
  return rawTargets
    .filter((t) => t.type === "page" && !t.url.startsWith("chrome://") && !t.url.startsWith("chrome-extension://"))
    .map((t) => {
      let wsUrl = t.webSocketDebuggerUrl;
      if (wsUrl && host !== "127.0.0.1" && host !== "localhost") {
        wsUrl = wsUrl.replace(/ws:\/\/(127\.0\.0\.1|localhost):/, `ws://${host}:`);
      }
      return { targetId: t.id, url: t.url, title: t.title, webSocketDebuggerUrl: wsUrl };
    });
}
