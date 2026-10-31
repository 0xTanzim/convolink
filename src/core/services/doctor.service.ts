import type { BrowserPort } from "../ports/browser.port.js";
import type { PlatformPort } from "../ports/platform.port.js";
import type { LockService } from "./lock.service.js";
import type { DiscoveredTab, DoctorReport, DoctorTabDiagnosis } from "./orchestrator.types.js";

export async function runDoctorAudit(
  browser: BrowserPort,
  tabs: readonly DiscoveredTab[],
  findDriver: (url: string) => PlatformPort | undefined,
  lockService: LockService,
): Promise<DoctorReport> {
  const transportHealth = await browser.health();
  const diagnoses: DoctorTabDiagnosis[] = [];

  for (const tab of tabs) {
    const driver = findDriver(tab.url);
    const isLocked = lockService.isLocked(tab.targetId);

    if (!driver) {
      diagnoses.push({ targetId: tab.targetId, title: tab.title, url: tab.url, platformId: null, selectorsOk: false, layoutVariant: null, isLocked });
      continue;
    }

    let selectorsOk = false, layoutVariant: string | null = null, error: string | undefined;
    try {
      const handle = await browser.attach(tab.targetId);
      const resolution = await driver.resolveSelectors(handle, browser);
      selectorsOk = resolution.ok;
      layoutVariant = resolution.layoutVariant;
      await browser.detach(handle);
    } catch (err: unknown) {
      error = err instanceof Error ? err.message : String(err);
    }

    diagnoses.push({ targetId: tab.targetId, title: tab.title, url: tab.url, platformId: driver.id, selectorsOk, layoutVariant, isLocked, error });
  }

  return {
    transportHealth,
    totalTabs: tabs.length,
    supportedTabs: diagnoses.filter((d) => d.platformId !== null).length,
    tabs: diagnoses,
  };
}
