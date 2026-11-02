import * as path from "node:path";
import * as os from "node:os";
import { ConvoError } from "../../core/errors/convo-error.js";
import type { BrowserPort } from "../../core/ports/browser.port.js";
import type { PlatformId } from "../../core/ports/platform.port.js";
import type { ResolvedSetup } from "../../core/services/setup/precedence.js";
import { buildMountedExpr } from "../platforms/page-events.js";
import { createBrowserAdapter } from "./browser-factory.js";
import { DEFAULT_PROFILE_DIRS } from "./default-profile-guard.js";

const PLATFORM_URLS: Readonly<Record<PlatformId, string>> = {
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/new",
  deepseek: "https://chat.deepseek.com/",
  gemini: "https://gemini.google.com/app",
};

const COMPOSERS: Readonly<Record<PlatformId, string>> = {
  chatgpt: 'div.ProseMirror[contenteditable="true"]',
  claude: 'div[contenteditable="true"]',
  deepseek: 'textarea#chat-input, div[contenteditable="true"]',
  gemini: "rich-textarea div.ql-editor",
};

export interface VerifyOptions {
  readonly factory?: (resolution: ResolvedSetup) => BrowserPort;
  readonly pageProbe?: boolean;
  readonly platform?: PlatformId;
  readonly timeoutMs?: number;
  /** Injectable for tests; defaults to ~/.config/<browser>. */
  readonly defaultProfilePath?: string;
  readonly home?: string;
}

export interface VerifyOutcome {
  readonly ok: boolean;
  readonly transportOk: boolean;
  readonly pageOk?: boolean;
  readonly error?: ConvoError;
  readonly warning?: string;
}

/**
 * Proves the selection works before anything is written. A failed page probe is
 * a warning, not a refusal: a network hiccup must not invalidate a browser that
 * answered correctly.
 */
export async function verifySetup(
  resolution: ResolvedSetup,
  options: VerifyOptions = {},
): Promise<VerifyOutcome> {
  if (isChromiumDefaultProfile(resolution, options)) {
    return {
      ok: false,
      transportOk: false,
      error: new ConvoError(
        "default-profile-blocked",
        `The default ${resolution.browserId} profile cannot be debugged.`,
        `Run \`convo setup\` and pick a dedicated profile, or start ${resolution.browserId} with --user-data-dir=<dedicated-path>.`,
      ),
    };
  }

  const browser = (options.factory ?? createBrowserAdapter)(resolution);
  try {
    const health = await browser.health().catch((error: unknown) => ({
      ok: false,
      adapterId: resolution.transport,
      endpoint: resolution.endpoint,
      openTabsCount: 0,
      latencyMs: 0,
      error: error instanceof Error ? error.message : String(error),
    }));

    if (!health.ok) {
      return {
        ok: false,
        transportOk: false,
        error: new ConvoError(
          "browser-unreachable",
          `${resolution.browserId} is not accepting a debug connection on ${resolution.endpoint}.`,
          remediationFor(resolution, health.error),
        ),
      };
    }

    if (options.pageProbe === false || !options.platform) {
      return { ok: true, transportOk: true };
    }

    const probed = await probePage(browser, options.platform, options.timeoutMs ?? 15_000);
    return probed.ok
      ? { ok: true, transportOk: true, pageOk: true }
      : {
          ok: true,
          transportOk: true,
          pageOk: false,
          warning: `${options.platform} page did not become ready: ${probed.reason}`,
        };
  } finally {
    await browser.disconnect?.().catch(() => {});
  }
}

function isChromiumDefaultProfile(resolution: ResolvedSetup, options: VerifyOptions): boolean {
  if (resolution.browserId === "firefox" || resolution.browserId === "zen") return false;
  if (!resolution.profilePath) return true;

  if (options.defaultProfilePath) {
    return path.normalize(resolution.profilePath) === path.normalize(options.defaultProfilePath);
  }
  const home = options.home ?? os.homedir();
  return DEFAULT_PROFILE_DIRS.some((dir) => path.normalize(path.join(home, dir)) === path.normalize(resolution.profilePath!));
}

function remediationFor(resolution: ResolvedSetup, detail?: string): string {
  const suffix = detail ? ` (${detail})` : "";
  if (resolution.transport === "firefox-bidi") {
    return `Run \`convo connect --firefox\` to (re)start ${resolution.browserId} with debugging${suffix}.`;
  }
  return `Start ${resolution.browserId} on the configured profile with --remote-debugging-port=${resolution.port}${suffix}.`;
}

async function probePage(
  browser: BrowserPort,
  platform: PlatformId,
  timeoutMs: number,
): Promise<{ ok: boolean; reason: string }> {
  if (!browser.createTab || !browser.closeTab) return { ok: false, reason: "transport cannot open a probe tab" };

  let targetId: string | undefined;
  try {
    const tab = await browser.createTab(PLATFORM_URLS[platform]);
    targetId = tab.targetId;
    const handle = await browser.attach(tab.targetId);
    const ready = await browser.evaluate<unknown>(
      handle,
      buildMountedExpr(COMPOSERS[platform], { maxWaitMs: timeoutMs }),
    );
    await browser.detach(handle).catch(() => {});
    return ready === true
      ? { ok: true, reason: "ready" }
      : { ok: false, reason: `composer ${COMPOSERS[platform]} not mounted` };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  } finally {
    if (targetId) await browser.closeTab(targetId).catch(() => {});
  }
}
