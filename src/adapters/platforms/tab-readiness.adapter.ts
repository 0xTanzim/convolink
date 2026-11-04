import type { BrowserPort, SessionHandle } from "../../core/ports/browser.port.js";
import type { PlatformPort } from "../../core/ports/platform.port.js";
import type { TabReadinessPort } from "../../core/ports/tab-readiness.port.js";
import { waitForDomQuiet, waitForMounted, withDeadline } from "./driver-helpers.js";
import { getTurnstileDetectionExpr, type TurnstileDetectionResult } from "../common/turnstile-detector.js";
import { AuthChallengeError } from "../../core/errors/bridge-errors.js";

const LAYOUT_POLL_MS = 250;

export class DefaultTabReadinessAdapter implements TabReadinessPort {
  public async waitUntilUsable(
    browser: BrowserPort,
    handle: SessionHandle,
    driver: PlatformPort,
    timeoutMs: number,
  ): Promise<void> {
    if (timeoutMs <= 0) return;
    const deadline = Date.now() + timeoutMs;

    let composerSelector: string | null = null;
    while (Date.now() < deadline) {
      const cf = await browser
        .evaluate<TurnstileDetectionResult>(handle, getTurnstileDetectionExpr())
        .catch(() => ({ detected: false, isInteractive: false }));
      if (cf.detected) {
        throw new AuthChallengeError(cf.isInteractive ? "turnstile" : "cloudflare", driver.getBaseUrl());
      }

      const resolved = await withDeadline(driver.resolveSelectors(handle, browser), 3000);
      if (resolved?.composerSelector) {
        composerSelector = resolved.composerSelector;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, LAYOUT_POLL_MS));
    }
    if (!composerSelector) return;

    await waitForMounted(browser, handle, composerSelector, Math.max(1000, deadline - Date.now()));
    await waitForDomQuiet(browser, handle, Math.min(2000, Math.max(0, deadline - Date.now())));
  }
}

export const defaultTabReadiness: TabReadinessPort = new DefaultTabReadinessAdapter();
