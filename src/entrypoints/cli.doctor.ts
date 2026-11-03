import { BrowserLocator } from "../core/env/browser-locator.js";
import { inspectFirefoxProfile } from "../adapters/browsers/firefox-profile.js";
import { fetchExtensionBridgeStatus } from "../adapters/browsers/extension-bridge.status.js";

export interface CapabilityItem {
  readonly id: string;
  readonly state: "ok" | "fail";
  readonly detail: string;
  readonly remediation?: string;
}

export interface CapabilityInput {
  readonly resolution?: {
    readonly browserId: string;
    readonly profilePath?: string;
    readonly transport: string;
    readonly endpoint: string;
  } | null;
  readonly transportOk: boolean;
  readonly transportError?: string;
  readonly extensionPort?: number;
}

export async function buildCapabilities(input: CapabilityInput): Promise<CapabilityItem[]> {
  const items: CapabilityItem[] = [];
  const resolution = input.resolution;

  items.push(
    resolution
      ? { id: "config", state: "ok", detail: `${resolution.browserId} · ${resolution.transport} · ${resolution.endpoint}` }
      : {
          id: "config",
          state: "fail",
          detail: "no browser configured for this project",
          remediation: "convo setup",
        },
  );

  const binary = resolution ? BrowserLocator.findBrowserExecutable(resolution.browserId) : null;
  items.push(
    binary
      ? { id: "browser-binary", state: "ok", detail: binary }
      : {
          id: "browser-binary",
          state: "fail",
          detail: "browser executable not found",
          remediation: "convo setup",
        },
  );

  items.push(
    input.transportOk
      ? {
          id: "debug-endpoint",
          state: "ok",
          // Show the endpoint actually used: an explicit host override must not
          // be reported as loopback.
          detail: (() => {
            const host = process.env.CONVOLINK_HOST;
            const endpoint = resolution?.endpoint ?? "connected";
            if (!host || !endpoint.startsWith("http")) return endpoint;
            const port = endpoint.match(/:(\d+)$/)?.[1];
            return port ? `http://${host}:${port}` : endpoint;
          })(),
        }
      : {
          id: "debug-endpoint",
          state: "fail",
          detail: input.transportError ?? "debug endpoint not reachable",
          remediation: resolution?.browserId === "zen"
            ? "convo connect --zen"
            : resolution?.browserId === "firefox"
            ? "convo connect --firefox"
            : `start ${resolution?.browserId ?? "the browser"} with --remote-debugging-port=<port>`,
        },
  );

  if (resolution?.profilePath) {
    const gecko = resolution.browserId === "firefox" || resolution.browserId === "zen";
    const lock = gecko ? inspectFirefoxProfile(resolution.profilePath) : { locked: false, debugging: false, pid: undefined };
    items.push(
      lock.locked && !lock.debugging
        ? {
            id: "profile",
            state: "fail",
            detail: `profile held by pid ${lock.pid ?? "?"} without debugging`,
            remediation: resolution.browserId === "zen"
              ? "convo connect --zen --restart"
              : "convo connect --firefox --restart",
          }
        : { id: "profile", state: "ok", detail: resolution.profilePath },
    );
  }

  const extension = await fetchExtensionBridgeStatus(input.extensionPort ?? 9224);
  const clients = extension.clients;
  items.push({
    id: "extension",
    state: extension.running ? "ok" : "fail",
    detail: extension.running
      ? `companion bridge on :${input.extensionPort ?? 9224} · ${clients.length} client(s)${
          clients.length > 0
            ? ` (${clients.map((client) => `${client.browserFamily}/${client.profileLabel} v${client.extensionVersion}`).join(", ")})`
            : ""
        }`
      : "companion bridge not running",
    ...(extension.running ? {} : { remediation: "convo ext pair" }),
  });

  return items;
}


