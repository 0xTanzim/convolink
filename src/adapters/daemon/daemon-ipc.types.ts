export type IpcCommand = "ask" | "compare" | "doctor" | "list" | "ping" | "stop" | "tab_new" | "tab_close" | "eval";

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
}
