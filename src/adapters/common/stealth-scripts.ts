/**
 * Hardened stealth preload scripts injected before page script execution.
 * Masks navigator.webdriver, stubs window.chrome, and normalizes browser fingerprints.
 */

export const STEALTH_PRELOAD_SCRIPT = `(() => {
  try {
    // 1. Scrub navigator.webdriver
    try {
      if (typeof navigator !== 'undefined') {
        const proto = Object.getPrototypeOf(navigator) || navigator;
        delete proto.webdriver;
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false,
          configurable: true,
          enumerable: true
        });
      }
    } catch (_) {}

    // 2. Stub window.chrome for Chromium compatibility
    try {
      if (typeof window !== 'undefined' && !window.chrome) {
        window.chrome = {
          runtime: { id: undefined },
          app: {
            isInstalled: false,
            InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
            RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
          },
          csi: () => {},
          loadTimes: () => ({
            requestTime: Date.now() / 1000,
            startLoadTime: Date.now() / 1000,
            commitLoadTime: Date.now() / 1000,
            finishDocumentLoadTime: Date.now() / 1000,
            finishLoadTime: Date.now() / 1000,
            firstPaintTime: Date.now() / 1000,
            firstPaintAfterLoadTime: 0,
            navigationType: 'Other',
            wasFetchedViaSpdy: false,
            wasNpnNegotiated: false,
            npnNegotiatedProtocol: '',
            wasAlternateProtocolAvailable: false,
            connectionInfo: 'http/1.1'
          })
        };
      }
    } catch (_) {}

    // 3. Stub Notification permission default
    try {
      if (typeof Notification !== 'undefined' && !Notification.permission) {
        Object.defineProperty(Notification, 'permission', {
          get: () => 'default',
          configurable: true
        });
      }
    } catch (_) {}
  } catch (_) {}
})();`;

export function getStealthPreloadScript(): string {
  return STEALTH_PRELOAD_SCRIPT;
}
