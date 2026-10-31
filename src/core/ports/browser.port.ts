export interface TabDescriptor {
  readonly targetId: string;
  readonly url: string;
  readonly title: string;
  readonly webSocketDebuggerUrl?: string;
}

export interface SessionHandle {
  readonly sessionId: string;
  readonly targetId: string;
  readonly adapterId: "raw-cdp" | "playwright" | "agent-browser";
}

export interface TransportHealth {
  readonly ok: boolean;
  readonly adapterId: string;
  readonly endpoint: string;
  readonly openTabsCount: number;
  readonly latencyMs: number;
  readonly error?: string;
}

export interface BrowserPort {
  readonly id: "raw-cdp" | "playwright" | "agent-browser";

  health(): Promise<TransportHealth>;
  listTabs(): Promise<TabDescriptor[]>;

  /** Attaches to a specific tab target without stealing OS window focus */
  attach(targetId: string): Promise<SessionHandle>;

  /** Cleanly severs the WebSocket connection; NEVER closes the user's tab or browser */
  detach(handle: SessionHandle): Promise<void>;

  /** Forces background tab rendering pipeline active without bringToFront() */
  keepAliveInBackground(handle: SessionHandle): Promise<void>;

  /** Only called when an interactive CAPTCHA/Auth challenge requires human intervention */
  bringToFront(handle: SessionHandle): Promise<void>;

  /** Universal execution denominator across all transports */
  evaluate<T>(handle: SessionHandle, expression: string): Promise<T>;

  /** Atomic text injection that does not trigger premature Enter submissions */
  fillText(handle: SessionHandle, selector: string, text: string): Promise<void>;
  click(handle: SessionHandle, selector: string): Promise<void>;
  pressKey(handle: SessionHandle, selector: string, key: string): Promise<void>;
  setInputFiles(handle: SessionHandle, selector: string, filePaths: string[]): Promise<void>;
  downloadFile?(handle: SessionHandle, url: string): Promise<Buffer>;
}
