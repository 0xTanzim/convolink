import * as path from "node:path";
import { HostEnv } from "../env/host-env.js";
import type {
  ConfigStorePort,
  ConvoProjectConfig,
} from "../ports/config.port.js";

export type { ConvoProjectConfig } from "../ports/config.port.js";

const CONFIG_DIR = ".convo";
const CONFIG_FILE = "config.json";

/** Pure merge: later values win, undefined never erases an existing value. */
export function mergeConfig(
  base: ConvoProjectConfig | null | undefined,
  partial: ConvoProjectConfig,
): ConvoProjectConfig {
  const merged: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as ConvoProjectConfig;
}

/**
 * Validation and path logic only. File access belongs to ConfigStorePort so the
 * domain kernel stays free of I/O and stays trivially testable.
 */
export class ConfigService {
  public constructor(
    private readonly store: ConfigStorePort,
    private readonly projectRoot?: string,
  ) {}

  public getConfigPath(projectRoot?: string): string {
    const root = projectRoot ?? this.projectRoot ?? process.env.CONVO_PROJECT_ROOT ?? process.cwd();
    return path.join(root, CONFIG_DIR, CONFIG_FILE);
  }

  public getGlobalConfigPath(): string {
    return path.join(HostEnv.getConfigDir(), CONFIG_FILE);
  }

  public async loadConfig(projectRoot?: string): Promise<ConvoProjectConfig | null> {
    const result = await this.store.load(projectRoot ?? this.projectRoot);
    if (result.status === "invalid") throw new Error(result.problem);
    return result.config;
  }

  public async saveConfig(config: ConvoProjectConfig, projectRoot?: string): Promise<string> {
    return this.store.save(config, projectRoot ?? this.projectRoot);
  }

  public async updateConfig(
    partial: ConvoProjectConfig,
    projectRoot?: string,
  ): Promise<ConvoProjectConfig> {
    return this.store.update(partial, projectRoot ?? this.projectRoot);
  }

  public validateProfilePath(
    profilePath?: string,
    exists: (candidate: string) => boolean = () => false,
  ): string | null {
    if (!profilePath || typeof profilePath !== "string") return null;
    const normalized = path.normalize(profilePath);
    return exists(normalized) ? normalized : null;
  }
}
