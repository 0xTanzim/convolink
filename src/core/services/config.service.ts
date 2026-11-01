import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

export interface ConvoProjectConfig {
  readonly profileId?: string;
  readonly profileEmail?: string;
  readonly profilePath?: string;
  readonly preferredPlatform?: "chatgpt" | "deepseek" | "gemini" | "claude";
  readonly transport?: "raw-cdp" | "agent-browser" | "firefox-bidi" | "extension-bridge";
  readonly cdpPort?: number;
}

export class ConfigService {
  private readonly defaultProjectRoot: string;

  constructor(projectRoot?: string) {
    this.defaultProjectRoot = projectRoot ?? process.cwd();
  }

  public getConfigPath(projectRoot?: string): string {
    const root = projectRoot ?? this.defaultProjectRoot;
    return path.join(root, ".convo", "config.json");
  }

  public getGlobalConfigPath(): string {
    return path.join(os.homedir(), ".config", "convolink", "config.json");
  }

  public async loadConfig(projectRoot?: string): Promise<ConvoProjectConfig | null> {
    const localPath = this.getConfigPath(projectRoot);
    if (fs.existsSync(localPath)) {
      try {
        const raw = await fs.promises.readFile(localPath, "utf8");
        return JSON.parse(raw) as ConvoProjectConfig;
      } catch {}
    }

    const globalPath = this.getGlobalConfigPath();
    if (fs.existsSync(globalPath)) {
      try {
        const raw = await fs.promises.readFile(globalPath, "utf8");
        return JSON.parse(raw) as ConvoProjectConfig;
      } catch {}
    }

    return null;
  }

  public async saveConfig(config: ConvoProjectConfig, projectRoot?: string): Promise<string> {
    const configPath = this.getConfigPath(projectRoot);
    const convoDir = path.dirname(configPath);

    if (!fs.existsSync(convoDir)) {
      await fs.promises.mkdir(convoDir, { recursive: true });
    }

    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
    return configPath;
  }

  public validateProfilePath(profilePath?: string): string | null {
    if (!profilePath || typeof profilePath !== "string") return null;
    const normalized = path.normalize(profilePath);
    if (fs.existsSync(normalized)) return normalized;
    return null;
  }

  public async updateConfig(partial: Partial<ConvoProjectConfig>, projectRoot?: string): Promise<ConvoProjectConfig> {
    const existing = (await this.loadConfig(projectRoot)) ?? {};
    const merged: ConvoProjectConfig = { ...existing, ...partial };
    await this.saveConfig(merged, projectRoot);
    return merged;
  }
}
