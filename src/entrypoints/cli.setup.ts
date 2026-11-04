import { ProjectConfigAdapter } from "../adapters/config/project-config.adapter.js";
import { discoverBrowsers, describeBrowser, searchLocations, type DiscoveredBrowser } from "../adapters/browsers/browser-catalog.js";
import { listProfiles, type CatalogProfile } from "../adapters/browsers/profile-catalog.js";
import { verifySetup } from "../adapters/browsers/setup-verifier.js";
import { ConvoError } from "../core/errors/convo-error.js";
import type { BrowserId, ConvoProjectConfig, TransportId } from "../core/ports/config.port.js";
import type { PlatformId } from "../core/ports/platform.port.js";
import type { ResolvedSetup } from "../core/services/setup/precedence.js";
import { SelectUnavailableError, selectFromList } from "./ui/terminal-select.js";
import { loadResolution, requireResolution } from "./config-context.js";

export interface SetupInput {
  readonly browserId?: BrowserId;
  readonly profilePath?: string;
  readonly browserPath?: string;
  readonly transport?: TransportId;
  readonly platform?: PlatformId;
  readonly verifyTab?: boolean;
  readonly saveOnly?: boolean;
  readonly noVerify?: boolean;
  readonly workDir?: string;
  /** Injected by tests; defaults to the real terminal selector. */
  readonly select?: typeof selectFromList;
}

export interface SetupOutcome {
  readonly config: ConvoProjectConfig;
  readonly resolution: ResolvedSetup;
  readonly warning?: string;
}

export function isInteractive(): boolean {
  if (process.env.CI || process.env.NON_INTERACTIVE) return false;
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

/**
 * Runs one verification, then persists. Nothing is written when verification
 * fails, so a stored config always describes a combination that answered.
 */
export async function applySetup(input: SetupInput): Promise<SetupOutcome> {
  const select = input.select ?? selectFromList;
  if (!input.browserId && !isInteractive() && !input.select) {
    throw new ConvoError(
      "selection-unavailable",
      "Interactive browser selection is unavailable in non-interactive environments.",
      "Pass --browser explicitly (e.g. --browser chrome), or use --json.",
    );
  }

  const installed = await discoverBrowsers();
  if (installed.length === 0 && !input.saveOnly && !input.noVerify) {
    throw new ConvoError(
      "no-browser-found",
      `No supported browser found. Searched: ${searchLocations().join(", ")}`,
      "Install Chrome, Brave, Edge, Chromium, Firefox, or Zen, then run `convo setup`.",
    );
  }

  const browser = await chooseBrowser(input, installed, select);
  const browserId = browser.descriptor.id;
  const profiles = await listProfiles(browserId);
  const profile = await chooseProfile(input, profiles, select);
  const descriptor = describeBrowser(browserId);

  const resolution = requireResolution(
    await loadResolution(
      {
        browserId,
        ...(profile ? { profilePath: profile.userDataDir, profileId: profile.profileId } : {}),
        ...(input.browserPath ? { browserPath: input.browserPath } : {}),
        ...(input.transport ? { transport: input.transport } : {}),
      },
      input.workDir,
    ),
  );

  let warning: string | undefined;
  if (!input.saveOnly && !input.noVerify) {
    const verified = await verifySetup(resolution, {
      pageProbe: input.verifyTab !== false,
      platform: input.platform ?? "deepseek",
    });
    if (!verified.ok && verified.error) throw verified.error;
    warning = verified.warning;
  } else {
    warning = "Saved without socket verification (--save-only).";
  }

  if (descriptor.family === "firefox" && resolution.transport === "firefox-bidi") {
    const zenNotice =
      "Notice: W3C WebDriver BiDi only enumerates awake/active tabs. For full visibility across hibernated Zen workspaces, the Extension Bridge transport is recommended.";
    warning = warning ? `${warning}\n${zenNotice}` : zenNotice;
  }

  const config: ConvoProjectConfig = {
    version: 1,
    browserId,
    ...(input.browserPath ?? browser.executable ? { browserPath: input.browserPath ?? browser.executable } : {}),
    ...(profile ? { profileId: profile.profileId, profilePath: profile.userDataDir } : {}),
    transport: resolution.transport,
    port: resolution.port,
    extension: descriptor.family === "firefox" ? "off" : "off",
  };

  const store = new ProjectConfigAdapter();
  await store.save(config, input.workDir);
  return { config, resolution, ...(warning ? { warning } : {}) };
}

async function chooseBrowser(
  input: SetupInput,
  installed: readonly DiscoveredBrowser[],
  select: typeof selectFromList,
): Promise<DiscoveredBrowser> {
  if (input.browserId) {
    const match = installed.find((candidate) => candidate.descriptor.id === input.browserId);
    if (!match) {
      if (input.saveOnly || input.noVerify) {
        return {
          descriptor: describeBrowser(input.browserId),
          executable: input.browserPath ?? "",
        };
      }
      throw new ConvoError(
        "no-browser-found",
        `${input.browserId} is not installed on this machine.`,
        `Run \`convo setup\` to choose from: ${installed.map((b) => b.descriptor.id).join(", ")}.`,
      );
    }
    return match;
  }

  const chosen = await select(
    "Which browser should ConvoLink drive?",
    installed.map((candidate) => ({
      id: candidate.descriptor.id,
      label: `${candidate.descriptor.displayName} — ${candidate.executable}`,
      hint: candidate.descriptor.debugSupport,
    })),
  );
  if (!chosen) throw new ConvoError("selection-unavailable", "Browser selection cancelled.", "Re-run `convo setup` when ready.");
  return installed.find((candidate) => candidate.descriptor.id === chosen.id)!;
}

async function chooseProfile(
  input: SetupInput,
  profiles: readonly CatalogProfile[],
  select: typeof selectFromList,
): Promise<CatalogProfile | null> {
  if (input.profilePath) {
    const match = profiles.find(
      (profile) => profile.userDataDir === input.profilePath || profile.profileId === input.profilePath,
    );
    if (match) return match;
    if (input.saveOnly || input.noVerify) {
      return {
        profileId: "custom", userDataDir: input.profilePath, name: "Custom Profile",
        isDefault: false, requiresDedicatedProfile: false, browser: (input.browserId ?? "chrome") as BrowserId,
        email: "", debuggable: false,
      };
    }
    throw new ConvoError(
      "configuration-invalid", `No profile matched '${input.profilePath}'.`,
      "Run `convo setup --show`-style discovery, or pass a profile directory that exists.",
    );
  }

  if (profiles.length === 0) return null;
  if (!isInteractive() && !input.select && profiles.length > 1) {
    throw new ConvoError(
      "selection-unavailable",
      "Interactive profile selection is unavailable in non-interactive environments.",
      "Pass --profile explicitly, or use a browser with a single profile.",
    );
  }

  const chosen = await select(
    "Which profile? (logins come from here)",
    profiles.map((p) => ({
      id: p.userDataDir, label: `${p.name}${p.email ? ` <${p.email}>` : ""}`,
      hint: p.debuggable ? "debuggable" : "needs a restart",
    })),
  );
  if (!chosen) throw new ConvoError("selection-unavailable", "Profile selection cancelled.", "Re-run `convo setup` when ready.");
  return profiles.find((profile) => profile.userDataDir === chosen.id) ?? null;
}

/** Browser-dependent commands call this so a first run sets up instead of guessing. */
export async function ensureConfigured(input: SetupInput = {}): Promise<ResolvedSetup> {
  const first = await loadResolution(
    {
      ...(input.browserId ? { browserId: input.browserId } : {}),
      ...(input.profilePath ? { profilePath: input.profilePath } : {}),
      ...(input.transport ? { transport: input.transport } : {}),
    },
    input.workDir,
  );
  if (first.ok) return first.value;
  if (first.error.code !== "configuration-required" || !isInteractive()) {
    throw new ConvoError(first.error.code, first.error.message, first.error.remediation);
  }

  const outcome = await applySetup({ ...input, verifyTab: false });
  return outcome.resolution;
}

export function describeProfileFlags(profiles: readonly CatalogProfile[]): string[] {
  return profiles.map(
    (profile) => `${profile.profileId} (${profile.debuggable ? "ready" : "restart needed"})`,
  );
}

export { SelectUnavailableError };
