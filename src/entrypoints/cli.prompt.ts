import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { BrowserDiscoveryService, type DiscoveredProfile } from "../adapters/browsers/browser-discovery.js";
import { ConfigService, type ConvoProjectConfig } from "../core/services/config.service.js";

export interface EnsureProfileOptions {
  workDir?: string;
  isInteractive?: boolean;
  profileArg?: string;
  discoverProfiles?: () => Promise<DiscoveredProfile[]>;
  promptInput?: (promptMessage: string) => Promise<string>;
}

export function isInteractiveSession(): boolean {
  if (process.env.CI || process.env.NON_INTERACTIVE || process.env.NODE_ENV === "test") return false;
  return Boolean(process.stdin.isTTY);
}

async function defaultPromptInput(msg: string): Promise<string> {
  const rl = readline.createInterface({ input, output });
  try {
    return await rl.question(msg);
  } finally {
    rl.close();
  }
}

export async function ensureProjectProfile(
  options: EnsureProfileOptions = {},
): Promise<ConvoProjectConfig | null> {
  const workDir = options.workDir;
  const configService = new ConfigService(workDir);

  const discover = options.discoverProfiles ?? (() => new BrowserDiscoveryService().discoverProfiles());
  const profiles = await discover();
  if (profiles.length === 0) return null;

  if (options.profileArg) {
    const target = options.profileArg.trim();
    const idxMatch = target.match(/^#?(\d+)$/);
    const matched = idxMatch && idxMatch[1]
      ? profiles[parseInt(idxMatch[1], 10) - 1]
      : profiles.find((p) => p.email.toLowerCase().includes(target.toLowerCase()) || p.name.toLowerCase().includes(target.toLowerCase()));
    if (matched) {
      const config: ConvoProjectConfig = {
        profileId: matched.profileId,
        profileEmail: matched.email,
        profilePath: matched.userDataDir,
      };
      await configService.updateConfig(config);
      return config;
    }
  }

  const existingConfig = await configService.loadConfig();
  if (existingConfig?.profileId || existingConfig?.profileEmail) {
    return existingConfig;
  }

  const interactive = options.isInteractive ?? isInteractiveSession();
  if (!interactive) {
    // Non-interactive fallback: auto-select primary profile without blocking stdin
    const primary = profiles[0]!;
    const config: ConvoProjectConfig = {
      profileId: primary.profileId,
      profileEmail: primary.email,
      profilePath: primary.userDataDir,
    };
    await configService.updateConfig(config);
    return config;
  }

  // Interactive modern UX wizard
  console.log("\n🧭 ConvoLink Setup: Link Browser Profile");
  console.log("No active profile configured in .convo/config.json.\n");
  profiles.forEach((p, idx) => {
    const num = idx + 1;
    const emailTag = p.email ? ` <${p.email}>` : "";
    const recTag = idx === 0 ? " (Recommended)" : "";
    console.log(`  ${num}) [${p.browser}] ${p.name}${emailTag}${recTag}`);
  });

  const prompt = options.promptInput ?? defaultPromptInput;
  const answer = (await prompt(`\nSelect a profile to link to this project [1-${profiles.length}] (default: 1): `)).trim();
  const selectedIdx = answer === "" ? 0 : Math.max(0, parseInt(answer, 10) - 1);
  const chosen = profiles[selectedIdx] ?? profiles[0]!;

  const config: ConvoProjectConfig = {
    profileId: chosen.profileId,
    profileEmail: chosen.email,
    profilePath: chosen.userDataDir,
  };
  await configService.updateConfig(config);

  console.log(`\n✅ Linked workspace to ${chosen.name} (${chosen.email || chosen.browser}). Saved to .convo/config.json.\n`);
  return config;
}
