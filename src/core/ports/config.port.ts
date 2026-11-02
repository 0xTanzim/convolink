import type { PlatformId } from "./platform.port.js";

export type BrowserId = "chrome" | "brave" | "edge" | "chromium" | "firefox" | "zen";

export type TransportId = "raw-cdp" | "agent-browser" | "firefox-bidi" | "extension-bridge";

/**
 * Machine-local target for this project. `version` is required on write; files
 * written before this field existed are read as v1.
 */
export interface ConvoProjectConfig {
  readonly version?: 1;
  readonly browserId?: BrowserId;
  readonly browserPath?: string;
  readonly profileId?: string;
  readonly profilePath?: string;
  readonly transport?: TransportId;
  readonly port?: number;
  readonly extension?: "off" | "paired";
  readonly defaultPlatform?: PlatformId;
  // Legacy fields kept readable for existing files; not written back.
  readonly browser?: string;
  readonly profileEmail?: string;
  readonly preferredPlatform?: PlatformId;
  readonly cdpPort?: number;
}

export type ConfigReadStatus = "missing" | "ok" | "invalid";

export interface ConfigReadResult {
  readonly status: ConfigReadStatus;
  readonly path: string;
  readonly config: ConvoProjectConfig | null;
  /** Present when status is "invalid": names the file and what is wrong. */
  readonly problem?: string;
}

export interface ConfigStorePort {
  load(workDir?: string): Promise<ConfigReadResult>;
  loadUser(): Promise<ConfigReadResult>;
  save(config: ConvoProjectConfig, workDir?: string): Promise<string>;
  update(partial: ConvoProjectConfig, workDir?: string): Promise<ConvoProjectConfig>;
  remove(workDir?: string): Promise<void>;
}
