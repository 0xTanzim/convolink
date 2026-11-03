import type { SessionOrchestrator } from "../core/services/orchestrator.js";
import type { SessionCheckpoint } from "../core/services/journal.service.js";
import { DaemonClient } from "../adapters/daemon/daemon-client.js";

interface DaemonReply<T> {
  readonly ok: boolean;
  readonly result?: T;
  readonly error?: string;
}

let fallbackOrchestrator: SessionOrchestrator | null = null;

/** Test seam allowing injection or reset of the in-process fallback orchestrator. */
export function setFallbackOrchestrator(orch: SessionOrchestrator | null): void {
  fallbackOrchestrator = orch;
}

async function getFallbackOrchestrator(): Promise<SessionOrchestrator> {
  if (!fallbackOrchestrator) {
    const [{ loadResolution }, { createContainer }] = await Promise.all([
      import("./config-context.js"),
      import("../container.js"),
    ]);
    const resolution = await loadResolution();
    fallbackOrchestrator = createContainer(resolution.ok ? { resolution: resolution.value } : {}).orchestrator;
  }
  return fallbackOrchestrator;
}

function isSocketDead(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes("ENOENT") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("EPIPE") ||
    msg.includes("closed") ||
    msg.includes("disconnected") ||
    msg.includes("ended")
  );
}

async function invokeInProcess(
  command: Parameters<DaemonClient["sendRequest"]>[0],
  payload?: Record<string, unknown>,
): Promise<any> {
  const orch = await getFallbackOrchestrator();
  switch (command) {
    case "list": return orch.listTabs();
    case "ask": return orch.ask(payload as any);
    case "compare": return orch.compare(payload as any);
    case "doctor": return orch.doctor();
    case "tab_new": return orch.createTab(payload?.target as string);
    case "tab_close": return orch.closeTab(payload?.targetId as string);
    case "tab_back": return orch.goBack(payload?.targetId as string);
    case "tab_undo": return orch.undo(payload?.targetId as string);
    case "thread_export": return orch.exportThread(payload?.threadId as string, payload?.format as any);
    case "thread_resume": return orch.resumeThread(payload?.threadId as string);
    case "ledger_search": return orch.searchLedger(payload?.query as string, payload?.limit as number);
    case "thread_history": return [];
    default: throw new Error(`Unknown daemon command: ${command}`);
  }
}

/**
 * The daemon owns the extension bridge socket on port 9224. A second process
 * that tries to create its own browser adapter fails with "Is port 9224 in
 * use?", so every browser-bound call is forwarded to the daemon instead.
 * If the daemon socket closes or is unreachable (e.g. user killed daemon),
 * transparently fall back to an in-process orchestrator.
 */
export function forward(
  client: DaemonClient,
  command: Parameters<DaemonClient["sendRequest"]>[0],
  payload?: Record<string, unknown>,
): () => Promise<any> {
  return async () => {
    if (fallbackOrchestrator) {
      return invokeInProcess(command, payload);
    }
    try {
      if (await client.isAlive()) {
        const reply = (await client.sendRequest(command, payload)) as DaemonReply<unknown>;
        if (!reply.ok) throw new Error(reply.error ?? `daemon command '${command}' failed`);
        return reply.result;
      }
      return await invokeInProcess(command, payload);
    } catch (error) {
      if (isSocketDead(error)) {
        return await invokeInProcess(command, payload);
      }
      throw error;
    }
  };
}

export async function createMcpOrchestrator(): Promise<SessionOrchestrator> {
  const client = new DaemonClient();
  if (!(await client.isAlive())) {
    try {
      const { loadResolution } = await import("./config-context.js");
      const res = await loadResolution();
      if (res.ok && (res.value.transport === "firefox-bidi" || res.value.transport === "extension-bridge")) {
        const { ensureDaemonRunning } = await import("./cli.daemon.js");
        await ensureDaemonRunning();
      }
    } catch {}
  }

  const shim: Pick<
    SessionOrchestrator,
    | "listTabs"
    | "ask"
    | "compare"
    | "doctor"
    | "createTab"
    | "closeTab"
    | "goBack"
    | "undo"
    | "exportThread"
    | "resumeThread"
    | "searchLedger"
  > & {
    /** The journal lives inside the daemon process, so history crosses the IPC boundary. */
    getHistory(targetId?: string): Promise<readonly SessionCheckpoint[]>;
  } = {
    listTabs: () => forward(client, "list")(),
    ask: (options) => forward(client, "ask", options as unknown as Record<string, unknown>)(),
    compare: (options) => forward(client, "compare", options as unknown as Record<string, unknown>)(),
    doctor: () => forward(client, "doctor")(),
    createTab: (platformOrUrl: string) => forward(client, "tab_new", { target: platformOrUrl })(),
    closeTab: (targetId: string) => forward(client, "tab_close", { targetId })(),
    goBack: (targetId?: string) => forward(client, "tab_back", targetId ? { targetId } : {})(),
    undo: (targetId?: string) => forward(client, "tab_undo", targetId ? { targetId } : {})(),
    exportThread: (threadId: string, format?: "json" | "markdown") =>
      forward(client, "thread_export", { threadId, format })(),
    getHistory: (targetId?: string) => forward(client, "thread_history", targetId ? { targetId } : {})(),
    resumeThread: (threadId: string) => forward(client, "thread_resume", { threadId })(),
    searchLedger: (query: string, limit?: number) => forward(client, "ledger_search", { query, limit })(),
  };

  return shim as unknown as SessionOrchestrator;
}
