export type JsonRecord = Record<string, unknown>;

export interface ExtensionTab {
  id?: number;
  url?: string;
  title?: string;
  windowId?: number;
  active?: boolean;
}

export interface DebuggerApi {
  attach(target: { tabId: number }, version: string): Promise<void>;
  detach(target: { tabId: number }): Promise<void>;
  sendCommand(target: { tabId: number }, method: string, params?: JsonRecord): Promise<unknown>;
}

export interface ExtensionApi {
  runtime: {
    getManifest(): { version: string };
    getURL(path: string): string;
    onStartup: { addListener(listener: () => void): void };
    onInstalled: { addListener(listener: () => void): void };
    onMessage: {
      addListener(
        listener: (message: JsonRecord, sender: unknown, respond: (value: unknown) => void) => boolean | void,
      ): void;
    };
  };
  storage: {
    local: { get(keys?: string[]): Promise<JsonRecord>; set(values: JsonRecord): Promise<void> };
    session?: { get(keys?: string[]): Promise<JsonRecord>; set(values: JsonRecord): Promise<void> };
  };
  alarms: {
    create(name: string, info: { delayInMinutes?: number; periodInMinutes?: number }): void;
    onAlarm: { addListener(listener: (alarm: { name: string }) => void): void };
  };
  tabs: {
    query(query: JsonRecord): Promise<ExtensionTab[]>;
    get(tabId: number): Promise<ExtensionTab>;
    create(options: JsonRecord): Promise<ExtensionTab>;
    remove(tabId: number): Promise<void>;
    update(tabId: number, options: JsonRecord): Promise<ExtensionTab>;
    duplicate(tabId: number): Promise<ExtensionTab>;
    captureVisibleTab(windowId: number, options?: JsonRecord): Promise<string>;
    onRemoved: { addListener(listener: (tabId: number) => void): void };
  };
  windows: {
    get(windowId: number, info?: JsonRecord): Promise<{ id?: number; state?: string; focused?: boolean }>;
    update(windowId: number, options: JsonRecord): Promise<unknown>;
  };
  scripting: {
    executeScript<T>(options: JsonRecord): Promise<Array<{ result?: T }>>;
  };
  debugger?: DebuggerApi;
}

export function resolveExtensionApi(): ExtensionApi {
  const scope = globalThis as unknown as { browser?: ExtensionApi; chrome?: ExtensionApi };
  return (scope.browser ?? scope.chrome) as ExtensionApi;
}

export interface OwnershipPort {
  ids(): readonly number[];
  has(tabId: number): boolean;
  add(tabId: number): void;
  remove(tabId: number): void;
  canClose(tabId: number, force: boolean): boolean;
}
