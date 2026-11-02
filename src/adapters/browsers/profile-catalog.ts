import * as fs from "node:fs";
import * as path from "node:path";
import {
  BrowserDiscoveryService,
  type DiscoveredProfile,
} from "./browser-discovery.js";
import { describeBrowser } from "./browser-catalog.js";
import { inspectFirefoxProfile } from "./firefox-profile.js";
import type { BrowserId } from "../../core/ports/config.port.js";

export interface CatalogProfile extends DiscoveredProfile {
  /** Last-used profile for its browser; not necessarily the right one for ConvoLink. */
  readonly isDefault: boolean;
  readonly requiresDedicatedProfile: boolean;
  /** True when ConvoLink can attach right now (running with debugging, or startable). */
  readonly debuggable: boolean;
  readonly lockOwnerPid?: number;
}

export interface ProfileCatalogOptions {
  readonly discover?: (browserId: BrowserId) => Promise<readonly DiscoveredProfile[]>;
  readonly readCmdline?: (pid: number) => string | null;
  readonly readPort?: (dir: string) => number | null;
}

/**
 * Adds the two facts a user cannot be expected to know: Chromium needs a
 * dedicated data directory, Gecko locks a profile to one process.
 */
export async function listProfiles(
  browserId: BrowserId,
  options: ProfileCatalogOptions = {},
): Promise<CatalogProfile[]> {
  const descriptor = describeBrowser(browserId);
  const profiles = await (options.discover?.(browserId) ?? defaultDiscover(browserId));
  const readPort = options.readPort ?? devToolsPort;

  return profiles.map((profile) => {
    const isDefault = isDefaultProfile(profile, descriptor.family);
    const requiresDedicatedProfile = descriptor.family === "chromium";

    if (descriptor.family === "firefox") {
      const lock = inspectFirefoxProfile(profile.userDataDir, {
        ...(options.readCmdline ? { readCmdline: options.readCmdline } : {}),
      });
      return {
        ...profile,
        isDefault,
        requiresDedicatedProfile,
        debuggable: !lock.locked || lock.debugging,
        ...(lock.pid ? { lockOwnerPid: lock.pid } : {}),
      };
    }

    const running = readPort(profile.userDataDir) !== null;
    return {
      ...profile,
      isDefault,
      requiresDedicatedProfile,
      // A default Chromium profile refuses a debug port even when running.
      debuggable: !isDefault || running,
    };
  });
}

async function defaultDiscover(browserId: BrowserId): Promise<readonly DiscoveredProfile[]> {
  return new BrowserDiscoveryService().getProfilesForBrowser(browserId);
}

function isDefaultProfile(profile: DiscoveredProfile, family: "chromium" | "firefox"): boolean {
  const name = profile.name.toLowerCase();
  const id = profile.profileId.toLowerCase();
  if (family === "firefox") return name.includes("default-release") || name === "default" || id === "default";
  return id === "default" || name === "default" || name.toLowerCase() === "person 1";
}

function devToolsPort(dir: string): number | null {
  try {
    const raw = fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8");
    const port = parseInt(raw.split("\n")[0]?.trim() ?? "", 10);
    return Number.isFinite(port) && port > 0 ? port : null;
  } catch {
    return null;
  }
}
