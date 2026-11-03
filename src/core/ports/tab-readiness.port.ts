import type { BrowserPort, SessionHandle } from "./browser.port.js";
import type { PlatformPort } from "./platform.port.js";

export interface TabReadinessPort {
  waitUntilUsable(
    browser: BrowserPort,
    handle: SessionHandle,
    driver: PlatformPort,
    timeoutMs: number,
  ): Promise<void>;
}
