import type { BrowserPort, SessionHandle } from "../ports/browser.port.js";
import type { PlatformId, PlatformPort } from "../ports/platform.port.js";
import type { LockService } from "./lock.service.js";
import type { StateJournalService } from "./journal.service.js";
import type { DiscoveredTab } from "./orchestrator.types.js";
import { TabResolver } from "./tab-resolver.js";
import { PlatformDriverNotFoundError, TabNotFoundError } from "../errors/bridge-errors.js";
import { waitForDomQuiet, waitForMounted, withDeadline } from "../../adapters/platforms/driver-helpers.js";
import { forgetManagedTab, isManagedTabRef, recordManagedTab } from "../../adapters/browsers/tab-registry.js";
import { findThreadTab, latestManagedTab } from "./tab-plan.js";
import { ConvoError } from "../errors/convo-error.js";
import type { ThreadTarget } from "./setup/thread-target.js";

export interface TabManagerOptions {
  /** How long a newly created tab may take to become usable. */
  readonly readinessTimeoutMs?: number;
}

// Page readiness is a real-world wait; unit tests construct this service
// directly and must not block for it.
const DEFAULT_READINESS_TIMEOUT_MS = process.env.NODE_ENV === "test" ? 0 : 20_000;
const LAYOUT_POLL_MS = 250;

export class TabManagerService {
  private readonly browser: BrowserPort;
  private readonly drivers: readonly PlatformPort[];
  private readonly lockService: LockService;
  private readonly journalService?: StateJournalService;
  private readonly readinessTimeoutMs: number;

  public constructor(
    browser: BrowserPort,
    drivers: readonly PlatformPort[],
    lockService: LockService,
    journalService?: StateJournalService,
    options: TabManagerOptions = {},
  ) {
    this.browser = browser;
    this.drivers = drivers;
    this.lockService = lockService;
    this.journalService = journalService;
    this.readinessTimeoutMs = options.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
  }

  /**
   * A tab is reported as created long before its framework has hydrated. Waiting
   * here means `convo tab new` returns a tab that can actually accept a prompt.
   */
  private async waitUntilUsable(targetId: string, driver: PlatformPort): Promise<void> {
    if (this.readinessTimeoutMs <= 0) return;
    const handle: SessionHandle = { sessionId: `ready-${targetId}`, targetId, adapterId: this.browser.id };
    const deadline = Date.now() + this.readinessTimeoutMs;

    let composerSelector: string | null = null;
    while (Date.now() < deadline) {
      const resolved = await withDeadline(driver.resolveSelectors(handle, this.browser), 3000);
      if (resolved?.composerSelector) {
        composerSelector = resolved.composerSelector;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, LAYOUT_POLL_MS));
    }
    if (!composerSelector) return;

    // Everything below polls from the host: a background tab throttles page
    // timers, and a long-lived in-page promise keeps the only BiDi socket busy.
    await waitForMounted(this.browser, handle, composerSelector, Math.max(1000, deadline - Date.now()));
    await waitForDomQuiet(this.browser, handle, Math.min(2000, Math.max(0, deadline - Date.now())));
  }

  /**
   * The tab descriptor is captured when the tab opens, before the platform has
   * created a conversation. Reading the live URL afterwards is what makes the
   * returned thread URL usable for continuation.
   */
  public async captureConversation(
    tab: DiscoveredTab,
    driver: PlatformPort,
    handle: SessionHandle,
  ): Promise<DiscoveredTab> {
    const href = await withDeadline(this.browser.evaluate<unknown>(handle, "location.href"), 5000);
    if (typeof href !== "string" || !href.startsWith("http")) return tab;

    const threadId = driver.extractThreadId(href);
    recordManagedTab({
      targetId: tab.targetId,
      platform: tab.platformId ?? "other",
      url: href,
      threadId,
      createdAt: new Date().toISOString(),
    });
    return { ...tab, url: href, threadId };
  }

  public async createTab(platformOrUrl: PlatformId | string): Promise<DiscoveredTab> {
    if (!this.browser.createTab) {
      throw new Error(`Transport ${this.browser.id} does not support createTab`);
    }

    const isUrl = platformOrUrl.startsWith("http://") || platformOrUrl.startsWith("https://");
    const driver = this.drivers.find((d) => d.id === platformOrUrl || d.matchesUrl(platformOrUrl));
    const url = isUrl ? platformOrUrl : (driver ? driver.getBaseUrl() : platformOrUrl);
    const tabDesc = await this.browser.createTab(url);

    if (driver) {
      await this.waitUntilUsable(tabDesc.targetId, driver);
    }

    const platform = driver?.id ?? null;
    const threadId = driver ? driver.extractThreadId(tabDesc.url) : null;

    this.journalService?.record({
      targetId: tabDesc.targetId,
      platformId: platform,
      url: tabDesc.url,
      threadId,
      action: "open_tab",
    });

    recordManagedTab({
      targetId: tabDesc.targetId,
      platform: platform ?? "other",
      url: tabDesc.url,
      threadId,
      createdAt: new Date().toISOString(),
    });

    return {
      targetId: tabDesc.targetId,
      title: tabDesc.title,
      url: tabDesc.url,
      platformId: platform,
      threadId,
      isNewlyCreated: true,
    };
  }

  public async closeTab(targetId: string): Promise<void> {
    if (!this.browser.closeTab) {
      throw new Error(`Transport ${this.browser.id} does not support closeTab`);
    }
    await this.browser.closeTab(targetId);
    forgetManagedTab(targetId);
  }

  public async startNewChat(tab: DiscoveredTab, driver: PlatformPort): Promise<void> {
    const lockHandle = await this.lockService.acquireLock(tab.targetId);
    let sessionHandle: SessionHandle | null = null;
    try {
      this.journalService?.record({
        targetId: tab.targetId,
        platformId: tab.platformId,
        url: tab.url,
        threadId: tab.threadId,
        action: "new_chat",
      });

      sessionHandle = await this.browser.attach(tab.targetId);
      if (driver.startNewChat) {
        await driver.startNewChat(sessionHandle, this.browser);
      } else {
        await this.browser.navigate?.(sessionHandle, driver.getBaseUrl());
      }
      // A reset reloads the SPA; typing before it re-hydrates leaves text the
      // framework does not see, so the send control never enables.
      await this.waitUntilUsable(tab.targetId, driver);
    } finally {
      if (sessionHandle) await this.browser.detach(sessionHandle);
      await this.lockService.releaseLock(lockHandle);
    }
  }

  public async resolveOrAutoOpenTab(
    options: { targetId?: string; platform?: PlatformId; prompt?: string; openTab?: boolean; thread?: ThreadTarget },
    tabs: DiscoveredTab[],
  ): Promise<DiscoveredTab> {
    if (options.targetId) return TabResolver.resolveTargetTab(options, tabs);
    if (options.openTab) return this.createTab(options.platform ?? "chatgpt");

    if (options.thread) return this.resolveThread(options.thread, tabs);

    const hasDriver = options.platform
      ? this.drivers.some((driver) => driver.id === options.platform)
      : false;
    if (options.platform && hasDriver && this.browser.createTab) {
      const managed = latestManagedTab(tabs, options.platform, (tab) => isManagedTabRef(tab));
      if (managed) return managed;
      return this.createTab(options.platform);
    }

    return TabResolver.resolveTargetTab(options, tabs);
  }

  /**
   * A named thread is explicit consent. Reuse the tab already showing it, or
   * open the conversation in a ConvoLink-owned tab and verify it really is that
   * thread before anyone types into it.
   */
  private async resolveThread(target: ThreadTarget, tabs: readonly DiscoveredTab[]): Promise<DiscoveredTab> {
    const existing = findThreadTab(tabs, target);
    if (existing) return existing;

    const created = await this.createTab(target.url);
    if (created.threadId !== null && created.threadId !== target.threadId) {
      await this.closeTab(created.targetId).catch(() => {});
      throw new ConvoError(
        "thread-not-found",
        `Opened ${target.url} but landed on thread '${created.threadId ?? "none"}'.`,
        "Check the conversation URL is still valid and that you are signed in for this profile.",
      );
    }
    return created;
  }

  public async undo(tab: DiscoveredTab): Promise<{ restoredUrl: string } | null> {
    if (!this.journalService || !this.browser.navigate) return null;
    const previous = this.journalService.getPrevious(tab.targetId);
    if (!previous?.url) return null;

    const lockHandle = await this.lockService.acquireLock(tab.targetId);
    let sessionHandle: SessionHandle | null = null;
    try {
      sessionHandle = await this.browser.attach(tab.targetId);
      await this.browser.navigate(sessionHandle, previous.url);
      return { restoredUrl: previous.url };
    } finally {
      if (sessionHandle) await this.browser.detach(sessionHandle);
      await this.lockService.releaseLock(lockHandle);
    }
  }

  public async goBack(targetId: string): Promise<void> {
    if (!this.browser.goBack) return;
    const lockHandle = await this.lockService.acquireLock(targetId);
    let sessionHandle: SessionHandle | null = null;
    try {
      sessionHandle = await this.browser.attach(targetId);
      await this.browser.goBack(sessionHandle);
    } finally {
      if (sessionHandle) await this.browser.detach(sessionHandle);
      await this.lockService.releaseLock(lockHandle);
    }
  }
}
