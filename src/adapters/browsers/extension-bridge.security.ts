import type { BridgeTokenService } from "../../core/services/bridge-token.service.js";

const LOOPBACK_IPS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost"]);

export function isLoopbackAddress(address?: string | null): boolean {
  if (!address) return true;
  return LOOPBACK_IPS.has(address);
}

export function isValidExtensionOrigin(origin: string | null): boolean {
  if (!origin) return true;
  return (
    origin.startsWith("chrome-extension://") ||
    origin.startsWith("moz-extension://") ||
    origin.startsWith("extension://")
  );
}

export function validateHandshakeToken(
  token: string | undefined,
  tokenService?: BridgeTokenService | { validateToken: (t?: string) => boolean },
): { valid: boolean; error?: string } {
  if (!tokenService) return { valid: true };
  if (!tokenService.validateToken(token)) {
    return { valid: false, error: "Invalid pairing token" };
  }
  return { valid: true };
}
