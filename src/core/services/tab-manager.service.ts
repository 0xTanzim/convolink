import type { BrowserPort, SessionHandle } from "../ports/browser.port.js";
import type { PlatformId, PlatformPort } from "../ports/platform.port.js";
import type { LockService } from "./lock.service.js";
import type { StateJournalService } from "./journal.service.js";
import type { DiscoveredTab } from "./orchestrator.types.js";
import { TabResolver } from "./tab-resolver.js";
import { PlatformDriverNotFoundError, TabNotFoundError } from "../errors/bridge-errors.js";

export class TabManagerService {
  private readonly browser: BrowserPort;
  private readonly drivers: readonly PlatformPort[];
  private readonly lockService: LockService;
  private readonly journalService?: StateJournalService;

  public constructor(
    browser: BrowserPort,
    drivers: readonly PlatformPort[],
    lockService: LockService,
    journalService?: StateJournalService,
  ) {
    this.browser = browser;
    this.drivers = drivers;
    this.lockService = lockService;
    this.journalService = journalService;
  }

  public async createTab(platformOrUrl: PlatformId | string): Promise<DiscoveredTab> {
    if (!this.browser.createTab) {
      throw new Error(`Transport ${this.browser.id} does not support createTab`);
    }

    const isUrl = platformOrUrl.startsWith("http://") || platformOrUrl.startsWith("https://");
    const driver = this.drivers.find((d) => d.id === platformOrUrl || d.matchesUrl(platformOrUrl));
    const url = isUrl ? platformOrUrl : (driver ? driver.getBaseUrl() : platformOrUrl);
    const tabDesc = await this.browser.createTab(url);

    const platform = driver?.id ?? null;
    const threadId = driver ? driver.extractThreadId(tabDesc.url) : null;

    this.journalService?.record({
      targetId: tabDesc.targetId,
      platformId: platform,
      url: tabDesc.url,
      threadId,
      action: "open_tab",
    });

    return {
      targetId: tabDesc.targetId,
      title: tabDesc.title,
      url: tabDesc.url,
      platformId: platform,
      threadId,
    };
  }

  public async closeTab(targetId: string): Promise<void> {
    if (!this.browser.closeTab) {
      throw new Error(`Transport ${this.browser.id} does not support closeTab`);
    }
    await this.browser.closeTab(targetId);
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
    } finally {
      if (sessionHandle) await this.browser.detach(sessionHandle);
      await this.lockService.releaseLock(lockHandle);
    }
  }

  public async resolveOrAutoOpenTab(
    options: { targetId?: string; platform?: PlatformId; prompt?: string; openTab?: boolean },
    tabs: DiscoveredTab[],
  ): Promise<DiscoveredTab> {
    if (options.openTab) {
      return this.createTab(options.platform ?? "chatgpt");
    }
    const matchingPlatformTab = options.platform ? tabs.find((t) => t.platformId === options.platform) : undefined;
    const hasDriver = options.platform ? this.drivers.some((d) => d.id === options.platform) : false;
    if (options.platform && !options.targetId && !matchingPlatformTab && hasDriver && this.browser.createTab) {
      return this.createTab(options.platform);
    }
    return TabResolver.resolveTargetTab(options, tabs);
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
