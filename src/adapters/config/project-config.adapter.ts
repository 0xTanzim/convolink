import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type {
  ConfigReadResult,
  ConfigStorePort,
  ConvoProjectConfig,
} from "../../core/ports/config.port.js";

const CURRENT_VERSION = 1;
const CONFIG_DIR = ".convo";
const CONFIG_FILE = "config.json";
const GITIGNORE_LINE = "config.json\n";
const SECRET_MODE = 0o600;
const KNOWN_KEYS = new Set([
  "version",
  "browserId",
  "browserPath",
  "profileId",
  "profilePath",
  "transport",
  "port",
  "extension",
  "defaultPlatform",
]);

export interface AdapterOptions {
  /** Overrides the user-level config directory; tests inject a temp path. */
  readonly userConfigDir?: string;
}

/**
 * Sole owner of config I/O. Writes are atomic (tmp + rename) because a crashed
 * process must not leave a half-written file that every later command rejects.
 */
export class ProjectConfigAdapter implements ConfigStorePort {
  private readonly userConfigDir: string;

  constructor(options: AdapterOptions = {}) {
    this.userConfigDir = options.userConfigDir ?? path.join(os.homedir(), ".config", "convolink");
  }

  public projectPath(workDir: string): string {
    return path.join(workDir, CONFIG_DIR, CONFIG_FILE);
  }

  public userPath(): string {
    return path.join(this.userConfigDir, CONFIG_FILE);
  }

  public async load(workDir?: string): Promise<ConfigReadResult> {
    return this.read(this.projectPath(workDir ?? process.cwd()));
  }

  public async loadUser(): Promise<ConfigReadResult> {
    return this.read(this.userPath());
  }

  public async save(config: ConvoProjectConfig, workDir?: string): Promise<string> {
    const target = this.projectPath(workDir ?? process.cwd());
    await this.write(target, this.toDisk(config));
    await this.ensureGitignored(path.dirname(target));
    return target;
  }

  public async update(partial: ConvoProjectConfig, workDir?: string): Promise<ConvoProjectConfig> {
    const target = this.projectPath(workDir ?? process.cwd());
    const existing = await this.read(target);
    if (existing.status === "invalid") throw new Error(existing.problem);

    const raw = this.readRaw(existing.path);
    const merged = { ...(existing.config ?? {}), ...partial };
    await this.write(target, this.toDisk(merged, raw));
    await this.ensureGitignored(path.dirname(target));
    return merged;
  }

  public async remove(workDir?: string): Promise<void> {
    await fs.promises.rm(this.projectPath(workDir ?? process.cwd()), { force: true });
  }

  private async read(file: string): Promise<ConfigReadResult> {
    let raw: string;
    try {
      raw = await fs.promises.readFile(file, "utf8");
    } catch (error) {
      if (isMissing(error)) return { status: "missing", path: file, config: null };
      return { status: "invalid", path: file, config: null, problem: `${file} is unreadable: ${messageOf(error)}` };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { status: "invalid", path: file, config: null, problem: `${file} is not valid JSON` };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { status: "invalid", path: file, config: null, problem: `${file} must contain a JSON object` };
    }

    const record = parsed as Record<string, unknown>;
    const version = record.version;
    if (version !== undefined && version !== CURRENT_VERSION) {
      return {
        status: "invalid",
        path: file,
        config: null,
        problem: `${file} declares unsupported version ${String(version)}; re-run \`convo setup --reset\``,
      };
    }

    return { status: "ok", path: file, config: this.fromDisk(record), problem: undefined };
  }

  private fromDisk(record: Record<string, unknown>): ConvoProjectConfig {
    const browser = typeof record.browser === "string" ? record.browser : undefined;
    const browserId = (record.browserId as ConvoProjectConfig["browserId"]) ?? legacyBrowserId(browser);
    return {
      version: CURRENT_VERSION,
      browserId,
      browserPath: typeof record.browserPath === "string" ? record.browserPath : undefined,
      profileId: typeof record.profileId === "string" ? record.profileId : undefined,
      profilePath: typeof record.profilePath === "string" ? record.profilePath : undefined,
      transport: record.transport as ConvoProjectConfig["transport"],
      port: typeof record.port === "number" ? record.port : undefined,
      extension: record.extension as ConvoProjectConfig["extension"],
      defaultPlatform: record.defaultPlatform as ConvoProjectConfig["defaultPlatform"],
      browser,
      profileEmail: typeof record.profileEmail === "string" ? record.profileEmail : undefined,
      preferredPlatform: record.preferredPlatform as ConvoProjectConfig["preferredPlatform"],
      cdpPort: typeof record.cdpPort === "number" ? record.cdpPort : undefined,
    };
  }

  private toDisk(config: ConvoProjectConfig, raw?: Record<string, unknown>): Record<string, unknown> {
    const unknownKeys = Object.fromEntries(
      Object.entries(raw ?? {}).filter(([key]) => !KNOWN_KEYS.has(key) && key !== "browser" && key !== "profileEmail"),
    );
    return {
      ...unknownKeys,
      version: CURRENT_VERSION,
      ...(config.browserId ? { browserId: config.browserId } : {}),
      ...(config.browserPath ? { browserPath: config.browserPath } : {}),
      ...(config.profileId ? { profileId: config.profileId } : {}),
      ...(config.profilePath ? { profilePath: config.profilePath } : {}),
      ...(config.transport ? { transport: config.transport } : {}),
      ...(config.port ? { port: config.port } : {}),
      ...(config.extension ? { extension: config.extension } : {}),
      ...(config.defaultPlatform ? { defaultPlatform: config.defaultPlatform } : {}),
    };
  }

  private readRaw(file: string): Record<string, unknown> {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private async write(target: string, data: Record<string, unknown>): Promise<void> {
    const dir = path.dirname(target);
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = `${target}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: SECRET_MODE });
    await fs.promises.rename(tmp, target);
    await fs.promises.chmod(target, SECRET_MODE);
  }

  private async ensureGitignored(dir: string): Promise<void> {
    const file = path.join(dir, ".gitignore");
    const existing = await fs.promises.readFile(file, "utf8").catch(() => "");
    if (existing.split("\n").map((line) => line.trim()).includes("config.json")) return;
    await fs.promises.writeFile(file, existing + (existing.endsWith("\n") || !existing ? "" : "\n") + GITIGNORE_LINE, "utf8");
  }
}

function legacyBrowserId(name?: string): ConvoProjectConfig["browserId"] {
  if (!name) return undefined;
  const raw = name.toLowerCase();
  if (raw.includes("zen")) return "zen";
  if (raw.includes("firefox")) return "firefox";
  if (raw.includes("brave")) return "brave";
  if (raw.includes("edge")) return "edge";
  if (raw.includes("chromium")) return "chromium";
  if (raw.includes("chrome")) return "chrome";
  return undefined;
}

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "ENOENT";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
