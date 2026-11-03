import type { DiscoveredTab } from "./orchestrator.types.js";
import type { ThreadTarget } from "./setup/thread-target.js";
import type { PlatformId } from "../ports/platform.port.js";

/** A tab already showing the named conversation. Exact URL or same thread id. */
export function findThreadTab(
  tabs: readonly DiscoveredTab[],
  target: ThreadTarget,
): DiscoveredTab | null {
  return (
    tabs.find(
      (tab) =>
        tab.platformId === target.platform &&
        (tab.url === target.url || (tab.threadId !== null && tab.threadId === target.threadId)),
    ) ?? null
  );
}

/** Latest ConvoLink-owned tab for a platform. Foreign tabs never qualify. */
export function latestManagedTab(
  tabs: readonly DiscoveredTab[],
  platform: PlatformId,
  isManaged: (tab: DiscoveredTab) => boolean,
): DiscoveredTab | null {
  const matches = tabs.filter((tab) => tab.platformId === platform && isManaged(tab));
  return matches.length > 0 ? matches[matches.length - 1]! : null;
}

/**
 * Compare must judge models on identical input, so it resets the conversation
 * unless the user pointed at threads or asked to continue.
 */
export function shouldStartFresh(options: {
  readonly hasThread: boolean;
  readonly continueThreads: boolean;
  readonly freshByDefault: boolean;
}): boolean {
  if (options.hasThread) return false;
  if (options.continueThreads) return false;
  return options.freshByDefault;
}
