import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { BrowserLocator } from "../../core/env/browser-locator.js";
import type { BrowserId } from "../../core/ports/config.port.js";

export type DebugSupport = "dedicated-profile-only" | "single-session";

export interface BrowserDescriptor {
  readonly id: BrowserId;
  readonly displayName: string;
  readonly family: "chromium" | "firefox";
  /**
   * Chromium ignores a debug port on its default profile; Gecko allows the real
   * profile but only one session and one process per profile.
   */
  readonly debugSupport: DebugSupport;
}

export interface DiscoveredBrowser {
  readonly descriptor: BrowserDescriptor;
  readonly executable: string;
}

export interface DiscoverOptions {
  /** Injectable for tests; defaults to the real filesystem. */
  readonly exists?: (candidate: string) => boolean;
  readonly locator?: (id: BrowserId) => string | null;
}

const DESCRIPTORS: Readonly<Record<BrowserId, BrowserDescriptor>> = {
  chrome: { id: "chrome", displayName: "Google Chrome", family: "chromium", debugSupport: "dedicated-profile-only" },
  chromium: { id: "chromium", displayName: "Chromium", family: "chromium", debugSupport: "dedicated-profile-only" },
  brave: { id: "brave", displayName: "Brave", family: "chromium", debugSupport: "dedicated-profile-only" },
  edge: { id: "edge", displayName: "Microsoft Edge", family: "chromium", debugSupport: "dedicated-profile-only" },
  firefox: { id: "firefox", displayName: "Mozilla Firefox", family: "firefox", debugSupport: "single-session" },
  zen: { id: "zen", displayName: "Zen Browser", family: "firefox", debugSupport: "single-session" },
};

const ORDER: readonly BrowserId[] = ["chrome", "brave", "edge", "chromium", "firefox", "zen"];

export function describeBrowser(id: BrowserId): BrowserDescriptor {
  return DESCRIPTORS[id];
}

export function listBrowsers(): readonly BrowserDescriptor[] {
  return ORDER.map((id) => DESCRIPTORS[id]);
}

/** Directories the locator inspects, exposed so a failure can name them. */
export function searchLocations(): readonly string[] {
  const home = os.homedir();
  return [
    path.join(home, ".config/google-chrome"),
    path.join(home, ".config/BraveSoftware/Brave-Browser"),
    path.join(home, ".config/microsoft-edge"),
    path.join(home, ".config/chromium"),
    path.join(home, ".mozilla/firefox"),
    path.join(home, ".config/zen"),
    "/snap/bin",
    "/var/lib/flatpak/exports/bin",
  ];
}

export async function discoverBrowsers(options: DiscoverOptions = {}): Promise<DiscoveredBrowser[]> {
  const exists = options.exists ?? fs.existsSync;
  const locate = options.locator ?? defaultLocator;
  const found: DiscoveredBrowser[] = [];

  for (const id of ORDER) {
    const descriptor = DESCRIPTORS[id];
    const executable = locate(id);
    if (executable && exists(executable)) found.push({ descriptor, executable });
  }
  return found;
}

function defaultLocator(id: BrowserId): string | null {
  return BrowserLocator.findBrowserExecutable(DESCRIPTORS[id].displayName);
}
