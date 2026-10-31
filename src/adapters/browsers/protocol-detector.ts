import type { BrowserProtocol } from "../../core/ports/browser.port.js";

export type HttpFetcher = (url: string) => Promise<Response>;

/**
 * Probes the listening browser port to determine whether it provides
 * the Chrome DevTools Protocol (CDP) or the W3C WebDriver BiDi standard.
 */
export async function detectBrowserProtocol(
  port: number = 9222,
  fetcher: HttpFetcher = fetch,
): Promise<BrowserProtocol> {
  try {
    const res = await fetcher(`http://127.0.0.1:${port}/json/version`);
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>;
      if (data["Browser"] || data["Protocol-Version"]) {
        return "cdp";
      }
    }
  } catch {
    // Non-CDP or connection refused on /json/version
  }

  return "webdriver-bidi";
}
