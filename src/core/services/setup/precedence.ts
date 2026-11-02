import { normalizeBrowserName } from "../../env/browser-name.js";
import type {
  BrowserId,
  ConvoProjectConfig,
  TransportId,
} from "../../ports/config.port.js";

export type ConfigSource = "flag" | "env" | "project" | "user" | "derived";

export interface SetupOverrides {
  readonly browserId?: BrowserId;
  readonly browserPath?: string;
  readonly profileId?: string;
  readonly profilePath?: string;
  readonly transport?: TransportId;
  readonly port?: number;
}

export interface SetupInput {
  readonly overrides: SetupOverrides;
  readonly project: ConvoProjectConfig | null;
  readonly user: ConvoProjectConfig | null;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface ResolvedSetup {
  readonly browserId: BrowserId;
  readonly browserPath?: string;
  readonly profileId?: string;
  readonly profilePath?: string;
  readonly transport: TransportId;
  readonly port: number;
  readonly endpoint: string;
  readonly sources: Readonly<Record<"browserId" | "profileId" | "profilePath" | "transport" | "port", ConfigSource>>;
}

export type SetupFailureCode = "configuration-required" | "configuration-invalid" | "transport-mismatch";

export interface SetupFailure {
  readonly code: SetupFailureCode;
  readonly message: string;
  readonly remediation: string;
}

export type SetupResolution =
  | { readonly ok: true; readonly value: ResolvedSetup }
  | { readonly ok: false; readonly error: SetupFailure };

const DEFAULTS: Readonly<Record<TransportId, number>> = {
  "raw-cdp": 9222,
  "agent-browser": 9222,
  "firefox-bidi": 9223,
  "extension-bridge": 9224,
};

interface Picked<T> {
  readonly value: T | undefined;
  readonly source: ConfigSource;
}

function pick<T>(
  flag: T | undefined,
  envValue: T | undefined,
  projectValue: T | undefined,
  userValue: T | undefined,
  derived?: T,
): Picked<T> {
  if (flag !== undefined) return { value: flag, source: "flag" };
  if (envValue !== undefined) return { value: envValue, source: "env" };
  if (projectValue !== undefined) return { value: projectValue, source: "project" };
  if (userValue !== undefined) return { value: userValue, source: "user" };
  return { value: derived, source: "derived" };
}

function familyOf(browserId: BrowserId): "chromium" | "firefox" {
  return browserId === "firefox" || browserId === "zen" ? "firefox" : "chromium";
}

function isTransportCompatible(browserId: BrowserId, transport: TransportId): boolean {
  if (transport === "extension-bridge") return true;
  return transport === "firefox-bidi" ? familyOf(browserId) === "firefox" : familyOf(browserId) === "chromium";
}

/**
 * Single source of truth for "which browser, which profile, which transport".
 * Pure: callers pass what every layer observed; nothing here invents a default
 * browser, because guessing one is what produced the wrong-transport hangs.
 */
export function resolveSetup(input: SetupInput): SetupResolution {
  const env = input.env ?? {};
  const project = input.project ?? {};
  const user = input.user ?? {};

  const browser = pick<BrowserId>(
    input.overrides.browserId,
    env.CONVOLINK_BROWSER ? normalizeBrowserName(env.CONVOLINK_BROWSER).id as BrowserId : undefined,
    project.browserId,
    user.browserId,
  );

  if (!browser.value) {
    return {
      ok: false,
      error: {
        code: "configuration-required",
        message: "No browser is configured for this project.",
        remediation: "Run `convo setup` to choose the browser and profile ConvoLink should drive.",
      },
    };
  }

  const browserId = browser.value;
  const derivedTransport = normalizeBrowserName(browserId).transport as TransportId;
  const transport = pick<TransportId>(
    input.overrides.transport,
    env.CONVOLINK_TRANSPORT as TransportId | undefined,
    project.transport,
    user.transport,
    derivedTransport,
  );

  if (!transport.value) {
    return {
      ok: false,
      error: {
        code: "transport-mismatch",
        message: `No transport can be derived for browser '${browserId}'.`,
        remediation: "Run `convo setup` and select the browser again.",
      },
    };
  }

  if (!isTransportCompatible(browserId, transport.value)) {
    return {
      ok: false,
      error: {
        code: "transport-mismatch",
        message: `Transport '${transport.value}' cannot drive browser '${browserId}'.`,
        remediation: "Drop the transport flag, or choose a browser from the same family via `convo setup`.",
      },
    };
  }

  const profilePath = pick(
    input.overrides.profilePath,
    env.CONVOLINK_PROFILE,
    project.profilePath,
    user.profilePath,
  );
  const profileId = pick(
    input.overrides.profileId,
    env.CONVOLINK_PROFILE_ID,
    project.profileId,
    user.profileId,
  );
  const browserPath = pick(input.overrides.browserPath, undefined, project.browserPath, user.browserPath);
  const port = pick(
    input.overrides.port,
    env.CONVOLINK_PORT ? Number(env.CONVOLINK_PORT) : undefined,
    project.port ?? project.cdpPort,
    user.port ?? user.cdpPort,
    DEFAULTS[transport.value],
  );

  const resolvedPort = port.value ?? DEFAULTS[transport.value];
  return {
    ok: true,
    value: {
      browserId,
      ...(browserPath.value ? { browserPath: browserPath.value } : {}),
      ...(profileId.value ? { profileId: profileId.value } : {}),
      ...(profilePath.value ? { profilePath: profilePath.value } : {}),
      transport: transport.value,
      port: resolvedPort,
      endpoint: `http://127.0.0.1:${resolvedPort}`,
      sources: {
        browserId: browser.source,
        profileId: profileId.source,
        profilePath: profilePath.source,
        transport: transport.source,
        port: port.source,
      },
    },
  };
}
