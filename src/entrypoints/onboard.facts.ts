import net from "node:net";
import path from "node:path";
import { ProjectConfigAdapter } from "../adapters/config/project-config.adapter.js";
import { BrowserDiscoveryService } from "../adapters/browsers/browser-discovery.js";
import { fetchExtensionBridgeStatus } from "../adapters/browsers/extension-bridge.status.js";
import { BridgeTokenService } from "../core/services/bridge-token.service.js";
import type { OnboardFacts, OnboardProfileOption } from "../core/services/onboarding.service.js";
import { loadResolution } from "./config-context.js";
import { readDaemonStatus } from "./daemon-status.js";
import { describeBuildMismatch, readExpectedBuildId } from "./extension-build.js";
import { resolveExtensionUnpackedPath } from "./extension-path.js";

const BRIDGE_PORT = 9224;
const TCP_PROBE_TIMEOUT_MS = 400;

function probeTcp(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(TCP_PROBE_TIMEOUT_MS, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

export async function collectOnboardFacts(): Promise<OnboardFacts> {
  const store = new ProjectConfigAdapter();
  const [project, resolution] = await Promise.all([store.load(process.cwd()), loadResolution()]);
  const resolved = resolution.ok ? resolution.value : null;
  const transport = resolved?.transport ?? "extension-bridge";
  const port = resolved?.port ?? BRIDGE_PORT;
  const usesBridge = transport === "extension-bridge";

  const extensionStatus = usesBridge ? await fetchExtensionBridgeStatus(port) : { clients: [], running: false };
  const connected = extensionStatus.clients.length > 0;
  const buildMismatch = describeBuildMismatch(
    extensionStatus.clients.map((client) => ({ buildId: client.buildId, profileLabel: client.profileLabel })),
    readExpectedBuildId(),
  );

  const discovered = await new BrowserDiscoveryService().discoverProfiles().catch(() => []);
  const profiles: OnboardProfileOption[] = discovered.map((profile) => ({
    browser: profile.browser,
    profileId: profile.profileId,
    name: profile.name,
    email: profile.email,
    userDataDir: profile.userDataDir,
  }));

  const hasProjectConfig = project.status === "ok" && project.config != null;
  const transportHealthy = usesBridge ? connected : await probeTcp(port);

  return {
    transport,
    port,
    daemon: { running: readDaemonStatus() !== null, endpoint: `http://127.0.0.1:${port}` },
    extension: {
      connected,
      clients: extensionStatus.clients.length,
      buildMismatch,
      unpackedPath: resolveExtensionUnpackedPath(),
      pairingToken: new BridgeTokenService().getToken(),
    },
    profiles,
    config: hasProjectConfig && resolved
      ? { browser: resolved.browserId, profilePath: resolved.profilePath ?? null, transport: resolved.transport, port: resolved.port }
      : null,
    transportHealthy,
  };
}
