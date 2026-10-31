export type BrowserAdapterId = "raw-cdp" | "playwright" | "agent-browser" | "firefox-bidi";
export type BrowserProtocol = "cdp" | "webdriver-bidi";
export type BrowserFamily = "chromium" | "firefox" | "webkit" | "unknown";

export interface BrowserCapabilities {
  readonly protocol: BrowserProtocol;
  readonly browserFamily: BrowserFamily;
  readonly supportsBackgroundLifecycle: boolean;
  readonly supportsFileDownloads: boolean;
  readonly supportsTabManagement: boolean;
}

export interface TabDescriptor {
  readonly targetId: string;
  readonly url: string;
  readonly title: string;
  readonly webSocketDebuggerUrl?: string;
}

export interface SessionHandle {
  readonly sessionId: string;
  readonly targetId: string;
  readonly adapterId: BrowserAdapterId;
}

export interface TransportHealth {
  readonly ok: boolean;
  readonly adapterId: string;
  readonly endpoint: string;
  readonly openTabsCount: number;
  readonly latencyMs: number;
  readonly error?: string;
  readonly capabilities?: BrowserCapabilities;
}

export interface BrowserPort {
  readonly id: BrowserAdapterId;
  readonly capabilities?: BrowserCapabilities;

  health(): Promise<TransportHealth>;
  listTabs(): Promise<TabDescriptor[]>;

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

  /** Creates a new browser tab navigating to the given URL */
  createTab?(url: string): Promise<TabDescriptor>;

  /** Closes a specific tab target cleanly */
  closeTab?(targetId: string): Promise<void>;

  /** Navigates an attached tab session to a new URL */
  navigate?(handle: SessionHandle, url: string): Promise<void>;

  /** Navigates an attached tab session back in browser history */
  goBack?(handle: SessionHandle): Promise<void>;
}
