import { BridgeTokenService } from "../core/services/bridge-token.service.js";
import { resolveExtensionUnpackedPath } from "./extension-path.js";
import { HostEnv } from "../core/env/host-env.js";
import { fetchExtensionBridgeStatus } from "../adapters/browsers/extension-bridge.status.js";
import { DaemonClient } from "../adapters/daemon/daemon-client.js";
import { describeBuildMismatch, readExpectedBuildId } from "./extension-build.js";

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
    const unpacked = resolveExtensionUnpackedPath();
    console.log("To pair your browser extension:");
    if (unpacked) {
      console.log(`  1. chrome://extensions -> Developer mode -> Load unpacked -> ${unpacked}`);
      console.log("     (Load the .output/chrome-mv3 folder, not extensions/convolink-companion itself.)");
    } else {
      console.log("  1. chrome://extensions -> Developer mode -> Load unpacked");
      console.log("     No unpacked bundle ships with this install. Download the Companion zip from");
      console.log("     https://github.com/0xTanzim/convolink/releases/latest, unzip it, and load that folder.");
    }
    console.log("  2. Start the bridge and keep it running: convo daemon start");
    console.log("  3. Open the extension popup and paste this token into 'Pairing Token'.");
    console.log("  4. Click 'Save Settings & Connect', then run: convo ext status\n");
    return 0;
  }

  if (subCommand === "status") {
    const json = args.includes("--json");
    const status = await fetchExtensionBridgeStatus();
    if (json) {
      const buildMismatch = describeBuildMismatch(status.clients, readExpectedBuildId());
      console.log(JSON.stringify({ ok: status.running, command: "ext", data: { ...status, buildMismatch }, error: null }, null, 2));
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
      const build = client.buildId && client.buildId !== "unknown" ? ` · build ${client.buildId}` : "";
      console.log(`   • ${client.browserFamily} [${client.profileLabel}] v${client.extensionVersion}${build} · ${client.tabCount} tab(s)`);
    }
    const mismatch = describeBuildMismatch(status.clients, readExpectedBuildId());
    if (mismatch) console.log(`\n   ⚠️ ${mismatch}`);
    console.log("");
    return 0;
  }

  if (subCommand === "exec") {
    const type = String(args[1] || "").toUpperCase();
    if (!type) {
      console.error("Usage: convo ext exec <COMMAND> ['<json payload>'] [--target <targetId>]");
      console.error("Example: convo ext exec DIAGNOSE '{}' --target 123456789");
      return 1;
    }
    const targetIndex = args.indexOf("--target");
    const targetId = targetIndex !== -1 ? args[targetIndex + 1] : undefined;
    const rawPayload = args[2] && args[2] !== "--target" ? args[2] : "{}";
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawPayload) as Record<string, unknown>;
    } catch (error) {
      console.error(`Invalid JSON payload: ${(error as Error).message}`);
      return 1;
    }
    const daemon = new DaemonClient();
    if (!(await daemon.isAlive())) {
      console.error("The bridge daemon is not running. Start it with `convo daemon start`.");
      return 3;
    }
    const response = await daemon.sendRequest("ext_exec", { type, payload, targetId });
    if (!response.ok) {
      console.error(`Extension command ${type} failed: ${response.error ?? "unknown error"}`);
      return 6;
    }
    console.log(JSON.stringify({ ok: true, command: type, data: response.result }, null, 2));
    return 0;
  }

  console.error(`Unknown ext command: ${subCommand}. Available: convo ext pair [--rotate] | convo ext status [--json] | convo ext exec <COMMAND> [json]`);
  return 1;
}
