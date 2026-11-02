/**
 * Turnstile detector and viewport coordinate solver.
 * Finds Cloudflare challenge iframes and calculates native OS/protocol click targets
 * without requiring cross-origin iframe DOM penetration.
 */

export interface TurnstileDetectionResult {
  readonly detected: boolean;
  readonly isInteractive: boolean;
  readonly rect?: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
}

/**
 * Returns a script expression to detect Cloudflare Turnstile iframes on the current page.
 */
export function getTurnstileDetectionExpr(): string {
  return `(() => {
    const iframe = document.querySelector(
      'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], div.cf-turnstile iframe, div#turnstile iframe'
    );
    if (!iframe) return { detected: false, isInteractive: false };

    const rect = iframe.getBoundingClientRect();
    const isVisible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(iframe).display !== 'none';
    if (!isVisible) return { detected: true, isInteractive: false };

    return {
      detected: true,
      isInteractive: true,
      rect: {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    };
  })()`;
}

/**
 * Calculates top-level viewport coordinates for clicking the Turnstile checkbox.
 * Cloudflare Turnstile's verification checkbox is placed at offset ~(28px, 32px) within the widget iframe.
 */
export function computeTurnstileClickCoords(
  rect: { left: number; top: number; width: number; height: number },
  randomFn = Math.random,
): { x: number; y: number } {
  // Checkbox center is standard ~(28, 32); add +/- 4px jitter
  const jitterX = randomFn() * 8 - 4;
  const jitterY = randomFn() * 8 - 4;

  return {
    x: Math.round(rect.left + 28 + jitterX),
    y: Math.round(rect.top + 32 + jitterY),
  };
}
