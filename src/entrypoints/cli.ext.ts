import { BridgeTokenService } from "../core/services/bridge-token.service.js";
import { HostEnv } from "../core/env/host-env.js";
import { fetchExtensionBridgeStatus } from "../adapters/browsers/extension-bridge.status.js";

export async function handleExt(args: string[], tokenService?: BridgeTokenService): Promise<number> {
  const subCommand = args[0] || "pair";
  const service = tokenService || new BridgeTokenService();

  if (subCommand === "pair") {
    const isRotate = args.includes("--rotate");
    const token = isRotate ? service.rotateToken() : service.getToken();

    if (isRotate) {
      console.log("\n🔄 Token rotated successfully!");
    }

    console.log("\n🔐 ConvoLink Extension Pairing Token:");
    console.log(`\n  Token:  ${token}`);
    console.log(`  Path:   ${HostEnv.getBridgeTokenPath()}\n`);
    console.log("To pair your browser extension:");
    console.log("  1. Open the ConvoLink Companion extension popup in your browser.");
    console.log("  2. Paste this token into the 'Pairing Token' field.");
    console.log("  3. Click 'Save Settings & Connect'.\n");
    return 0;
  }

  if (subCommand === "status") {
    const json = args.includes("--json");
    const status = await fetchExtensionBridgeStatus();
    if (json) {
      console.log(JSON.stringify({ ok: status.running, command: "ext", data: status, error: null }, null, 2));
      return status.running ? 0 : 3;
    }
    if (!status.running) {
      console.log(`\n🛑 Companion bridge is not running at ${status.endpoint}`);
      console.log("   Start a ConvoLink command or the daemon, then reload the extension.\n");
      return 3;
    }
    console.log(`\n🌉 Companion bridge: ${status.endpoint}`);
    if (status.clients.length === 0) {
      console.log("   No extension connected. Run `convo ext pair`, paste the token in the popup, and reload.\n");
      return 0;
    }
    console.log(`   Connected clients: ${status.clients.length}\n`);
    for (const client of status.clients) {
      console.log(`   • ${client.browserFamily} [${client.profileLabel}] v${client.extensionVersion} · ${client.tabCount} tab(s)`);
    }
    console.log("");
    return 0;
  }

  console.error(`Unknown ext command: ${subCommand}. Available: convo ext pair [--rotate] | convo ext status [--json]`);
  return 1;
}
