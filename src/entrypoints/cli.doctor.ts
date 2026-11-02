import * as net from "node:net";
import { BrowserLocator } from "../core/env/browser-locator.js";
import { inspectFirefoxProfile } from "../adapters/browsers/firefox-profile.js";

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
      ? { id: "debug-endpoint", state: "ok", detail: resolution?.endpoint ?? "connected" }
      : {
          id: "debug-endpoint",
          state: "fail",
          detail: input.transportError ?? "debug endpoint not reachable",
          remediation: resolution?.browserId === "firefox" || resolution?.browserId === "zen"
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
            remediation: "convo connect --firefox --restart",
          }
        : { id: "profile", state: "ok", detail: resolution.profilePath },
    );
  }

  const extensionAlive = await isPortListening(input.extensionPort ?? 9224);
  items.push({
    id: "extension",
    state: extensionAlive ? "ok" : "fail",
    detail: extensionAlive ? `companion bridge on :${input.extensionPort ?? 9224}` : "companion bridge not running",
    ...(extensionAlive ? {} : { remediation: "convo ext pair" }),
  });

  return items;
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(300);
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.once("timeout", () => done(false));
  });
}
