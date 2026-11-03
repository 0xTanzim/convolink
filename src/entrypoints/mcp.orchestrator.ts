import type { SessionOrchestrator } from "../core/services/orchestrator.js";
import type { SessionCheckpoint } from "../core/services/journal.service.js";
import { DaemonClient } from "../adapters/daemon/daemon-client.js";

interface DaemonReply<T> {
  readonly ok: boolean;
  readonly result?: T;
  readonly error?: string;
}

/**
 * The daemon owns the extension bridge socket on port 9224. A second process
 * that tries to create its own browser adapter fails with "Is port 9224 in
 * use?", so every browser-bound call is forwarded to the daemon instead.
 */
function forward(
  client: DaemonClient,
  command: Parameters<DaemonClient["sendRequest"]>[0],
  payload?: Record<string, unknown>,
): () => Promise<any> {
  return async () => {
    const reply = (await client.sendRequest(command, payload)) as DaemonReply<unknown>;
    if (!reply.ok) throw new Error(reply.error ?? `daemon command '${command}' failed`);
    return reply.result;
  };
}

export async function createMcpOrchestrator(): Promise<SessionOrchestrator> {
  const client = new DaemonClient();
  if (!(await client.isAlive())) {
    const [{ loadResolution }, { createContainer }] = await Promise.all([
      import("./config-context.js"),
      import("../container.js"),
    ]);
    const resolution = await loadResolution();
    return createContainer(resolution.ok ? { resolution: resolution.value } : {}).orchestrator;
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
