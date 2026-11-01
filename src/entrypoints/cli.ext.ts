import { BridgeTokenService } from "../core/services/bridge-token.service.js";
import { HostEnv } from "../core/env/host-env.js";

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

  console.error(`Unknown ext command: ${subCommand}. Available: convo ext pair [--rotate]`);
  return 1;
}
