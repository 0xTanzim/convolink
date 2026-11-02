import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { TabDescriptor } from "../../core/ports/browser.port.js";
import type { CdpTarget } from "./raw-cdp.types.js";

/**
 * Searches system profile directories for active DevToolsActivePort.
 */
export function findBrowserWsUrl(host: string, port: number, customDir?: string): string | null {
  if (process.env.NODE_ENV === "test" && !customDir) return null;
  const dirs = [
    customDir,
    path.join(os.homedir(), ".config/google-chrome"),
    path.join(os.homedir(), ".config/chromium"),
    path.join(os.homedir(), ".config/microsoft-edge"),
    path.join(os.homedir(), ".config/BraveSoftware/Brave-Browser"),
  ].filter(Boolean) as string[];

  for (const dir of dirs) {
    const portFile = path.join(dir, "DevToolsActivePort");
    if (fs.existsSync(portFile)) {
      try {
        const lines = fs.readFileSync(portFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
        const p = parseInt(lines[0] || "", 10);
        const wsPath = lines[1];
        if (p === port && wsPath) {
          return `ws://${host}:${port}${wsPath}`;
        }
      } catch {}
    }
  }
  return null;
}

/**
 * Queries CDP targets from /json/list and standardizes WebSocket debugger URLs.
 */
export async function queryCdpTargets(host: string, port: number): Promise<TabDescriptor[]> {
  const res = await fetch(`http://${host}:${port}/json/list`, { signal: AbortSignal.timeout(1000) });
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

export async function createCdpTab(host: string, port: number, url: string): Promise<TabDescriptor> {
  const res = await fetch(`http://${host}:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to create tab`);
  const data = (await res.json()) as CdpTarget;
  return { targetId: data.id, url: data.url, title: data.title, webSocketDebuggerUrl: data.webSocketDebuggerUrl };
}

export async function closeCdpTab(host: string, port: number, targetId: string): Promise<void> {
  await fetch(`http://${host}:${port}/json/close/${targetId}`);
}
