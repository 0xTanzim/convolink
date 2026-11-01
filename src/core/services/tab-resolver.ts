import type { PlatformId, PlatformPort } from "../ports/platform.port.js";
import type { TabDescriptor } from "../ports/browser.port.js";
import type { DiscoveredTab } from "./orchestrator.types.js";
import { AmbiguousTabError, TabNotFoundError } from "../errors/bridge-errors.js";

export class TabResolver {
  public static toDiscoveredTab(raw: TabDescriptor, drivers: readonly PlatformPort[]): DiscoveredTab {
    const driver = this.findDriver(raw.url, drivers);
    return {
      targetId: raw.targetId,
      title: raw.title,
      url: raw.url,
      platformId: driver?.id ?? null,
      threadId: driver ? driver.extractThreadId(raw.url) : null,
    };
  }

  public static findDriver(url: string, drivers: readonly PlatformPort[]): PlatformPort | undefined {
    return drivers.find((d) => d.matchesUrl(url));
  }

  public static resolveTargetTab(
    options: { targetId?: string; platform?: PlatformId; prompt?: string; disallowAmbiguous?: boolean },
    tabs: DiscoveredTab[],
  ): DiscoveredTab {
    if (options.targetId) {
      return this.resolveByTargetId(options.targetId, tabs);
    }
    if (options.platform) {
      const matching = tabs.filter((t) => t.platformId === options.platform);
      if (matching.length === 0) throw new TabNotFoundError(`platform:${options.platform}`);
      if (options.disallowAmbiguous && matching.length > 1) {
        throw new AmbiguousTabError(`platform '${options.platform}'`, matching);
      }
      return matching[0]!;
    }
    const supported = tabs.filter((t) => t.platformId !== null);
    if (supported.length === 0) throw new TabNotFoundError("No active tabs with supported AI platform found");
    if (options.disallowAmbiguous && supported.length > 1) {
      throw new AmbiguousTabError("multiple open AI tabs", supported);
    }
    return supported[0]!;
  }

  private static resolveByTargetId(targetId: string, tabs: DiscoveredTab[]): DiscoveredTab {
    const trimmed = targetId.trim();
    // Shorthand index matching: #1, @2, 1
    const indexMatch = trimmed.match(/^[#@]?(\d+)$/);
    if (indexMatch && indexMatch[1]) {
      const idx = parseInt(indexMatch[1], 10);
      if (idx >= 1 && idx <= tabs.length) {
        return tabs[idx - 1]!;
      }
      throw new TabNotFoundError("index", targetId);
    }

    const found = tabs.find((t) => t.targetId === trimmed);
    if (!found) throw new TabNotFoundError(undefined, targetId);
    return found;
  }
}
