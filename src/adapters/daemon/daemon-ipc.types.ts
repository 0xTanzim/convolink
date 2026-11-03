export type IpcCommand =
  | "ask"
  | "compare"
  | "doctor"
  | "list"
  | "ping"
  | "stop"
  | "tab_new"
  | "tab_close"
  | "tab_focus"
  | "tab_back"
  | "tab_undo"
  | "thread_resume"
  | "thread_export"
  | "thread_history"
  | "ledger_search"
  | "ext_exec"
  | "eval";

export interface IpcRequest {
  readonly id: string;
  readonly command: IpcCommand;
  readonly payload?: Record<string, unknown>;
}

export interface IpcResponse {
  readonly id: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
  /** Structured classification, so a client never has to parse the message. */
  readonly code?: string;
}
