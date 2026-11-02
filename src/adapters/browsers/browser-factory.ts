import { AgentBrowserAdapter } from "./agent-browser.adapter.js";
import { ExtensionBridgeAdapter } from "./extension-bridge.adapter.js";
import { FirefoxBidiAdapter } from "./firefox-bidi.adapter.js";
import { RawCdpAdapter } from "./raw-cdp.adapter.js";
import { BridgeTokenService } from "../../core/services/bridge-token.service.js";
import type { BrowserPort } from "../../core/ports/browser.port.js";
import type { TransportId } from "../../core/ports/config.port.js";

export interface AdapterEndpoint {
  readonly transport: TransportId;
  readonly endpoint: string;
  readonly port: number;
}

/** One construction point for transports, shared by the container and setup. */
export function createBrowserAdapter(target: AdapterEndpoint): BrowserPort {
  switch (target.transport) {
    case "agent-browser":
      return new AgentBrowserAdapter(target.port);
    case "firefox-bidi":
      return new FirefoxBidiAdapter(target.port);
    case "extension-bridge":
      return new ExtensionBridgeAdapter(target.port, new BridgeTokenService());
    default:
      return new RawCdpAdapter(target.endpoint);
  }
}
