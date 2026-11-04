import type { BrowserPort, SessionHandle } from "../ports/browser.port.js";
import type { PlatformId, PlatformPort } from "../ports/platform.port.js";
import type { LockService } from "./lock.service.js";
import type { StateJournalService } from "./journal.service.js";
import type { DiscoveredTab } from "./orchestrator.types.js";
import { TabResolver } from "./tab-resolver.js";
import { findThreadTab, latestManagedTab } from "./tab-plan.js";
import { ConvoError } from "../errors/convo-error.js";
import type { ThreadTarget } from "./setup/thread-target.js";
import type { TabRegistryPort } from "../ports/tab-registry.port.js";
import type { TabReadinessPort } from "../ports/tab-readiness.port.js";

export interface TabManagerOptions {
  /** How long a newly created tab may take to become usable. */
  readonly readinessTimeoutMs?: number;
  readonly tabRegistry?: TabRegistryPort;
  readonly tabReadiness?: TabReadinessPort;
}

const DEFAULT_READINESS_TIMEOUT_MS = process.env.NODE_ENV === "test" ? 0 : 20_000;

const noOpTabRegistry: TabRegistryPort = {
  recordManagedTab: () => {}, forgetManagedTab: () => {}, isManagedTab: () => false, isManagedTabRef: () => false,
};

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
  return Promise.race([
    promise.catch(() => undefined),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), ms)),
  ]);
}

export class TabManagerService {
  private static defaultRegistry: TabRegistryPort = noOpTabRegistry;

  public static setDefaultRegistry(registry: TabRegistryPort): void {
    this.defaultRegistry = registry;
  }

  private readonly browser: BrowserPort;
  private readonly drivers: readonly PlatformPort[];
  private readonly lockService: LockService;
  private readonly journalService?: StateJournalService;
  private readonly readinessTimeoutMs: number;
  private readonly tabRegistry: TabRegistryPort;
  private readonly tabReadiness?: TabReadinessPort;

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
    this.tabRegistry = options.tabRegistry ?? TabManagerService.defaultRegistry;
    this.tabReadiness = options.tabReadiness;
  }

  private async waitUntilUsable(targetId: string, driver: PlatformPort): Promise<void> {
    if (this.readinessTimeoutMs <= 0 || !this.tabReadiness) return;
    const handle: SessionHandle = { sessionId: `ready-${targetId}`, targetId, adapterId: this.browser.id };
    await this.tabReadiness.waitUntilUsable(this.browser, handle, driver, this.readinessTimeoutMs);
  }

  public async captureConversation(
    tab: DiscoveredTab,
    driver: PlatformPort,
    handle: SessionHandle,
  ): Promise<DiscoveredTab> {
    const href = await withDeadline(this.browser.evaluate<unknown>(handle, "location.href"), 5000);
    if (typeof href !== "string" || !href.startsWith("http")) return tab;

    const threadId = driver.extractThreadId(href);
    this.tabRegistry.recordManagedTab({
      targetId: tab.targetId, platform: tab.platformId ?? "other", url: href, threadId, createdAt: new Date().toISOString(),
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
    if (driver) await this.waitUntilUsable(tabDesc.targetId, driver);

    const platform = driver?.id ?? null;
    const threadId = driver ? driver.extractThreadId(tabDesc.url) : null;
    this.journalService?.record({
      targetId: tabDesc.targetId, platformId: platform, url: tabDesc.url, threadId, action: "open_tab",
    });
    this.tabRegistry.recordManagedTab({
      targetId: tabDesc.targetId, platform: platform ?? "other", url: tabDesc.url, threadId, createdAt: new Date().toISOString(),
    });

    return {
      targetId: tabDesc.targetId, title: tabDesc.title, url: tabDesc.url, platformId: platform, threadId, isNewlyCreated: true,
    };
  }

  public async closeTab(targetId: string): Promise<void> {
    if (!this.browser.closeTab) {
      throw new Error(`Transport ${this.browser.id} does not support closeTab`);
    }
    await this.browser.closeTab(targetId);
    this.tabRegistry.forgetManagedTab(targetId);
  }

  public async startNewChat(tab: DiscoveredTab, driver: PlatformPort): Promise<void> {
    await this.lockService.withLock(tab.targetId, async () => {
      this.journalService?.record({
        targetId: tab.targetId, platformId: tab.platformId,
        url: tab.url, threadId: tab.threadId, action: "new_chat",
      });
      const sessionHandle = await this.browser.attach(tab.targetId);
      try {
        if (driver.startNewChat) {
          await driver.startNewChat(sessionHandle, this.browser);
        } else {
          await this.browser.navigate?.(sessionHandle, driver.getBaseUrl());
        }
        await this.waitUntilUsable(tab.targetId, driver);
      } finally {
        await this.browser.detach(sessionHandle);
      }
    });
  }

  public async resolveOrAutoOpenTab(
    options: { targetId?: string; platform?: PlatformId; prompt?: string; openTab?: boolean; thread?: ThreadTarget },
    tabs: DiscoveredTab[],
  ): Promise<DiscoveredTab> {
    if (options.targetId) return TabResolver.resolveTargetTab(options, tabs);
    if (options.openTab) return this.createTab(options.platform ?? "chatgpt");
    if (options.thread) return this.resolveThread(options.thread, tabs);

    const hasDriver = options.platform ? this.drivers.some((d) => d.id === options.platform) : false;
    if (options.platform && hasDriver && this.browser.createTab) {
      const managed = latestManagedTab(tabs, options.platform, (t) => this.tabRegistry.isManagedTabRef(t));
      if (managed) return managed;
      return this.createTab(options.platform);
    }

    return TabResolver.resolveTargetTab(options, tabs);
  }

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
    return this.lockService.withLock(tab.targetId, async () => {
      const handle = await this.browser.attach(tab.targetId);
      try {
        await this.browser.navigate!(handle, previous.url!);
        return { restoredUrl: previous.url! };
      } finally {
        await this.browser.detach(handle);
      }
    });
  }

  public async goBack(targetId: string): Promise<void> {
    if (!this.browser.goBack) return;
    await this.lockService.withLock(targetId, async () => {
      const handle = await this.browser.attach(targetId);
      try {
        await this.browser.goBack!(handle);
      } finally {
        await this.browser.detach(handle);
      }
    });
  }
}
