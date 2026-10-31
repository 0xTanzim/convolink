import type { PlatformId, PlatformPort } from "../ports/platform.port.js";
import type { TabDescriptor } from "../ports/browser.port.js";
import type { DiscoveredTab } from "./orchestrator.types.js";
import { TabNotFoundError } from "../errors/bridge-errors.js";

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
    options: { targetId?: string; platform?: PlatformId; prompt?: string },
    tabs: DiscoveredTab[],
  ): DiscoveredTab {
    if (options.targetId) {
      const found = tabs.find((t) => t.targetId === options.targetId);
      if (!found) throw new TabNotFoundError(`targetId:${options.targetId}`);
      return found;
    }
    if (options.platform) {
      const found = tabs.find((t) => t.platformId === options.platform);
      if (!found) throw new TabNotFoundError(`platform:${options.platform}`);
      return found;
    }
    const supported = tabs.find((t) => t.platformId !== null);
    if (!supported) throw new TabNotFoundError("No active tabs with supported AI platform found");
    return supported;
  }
}
