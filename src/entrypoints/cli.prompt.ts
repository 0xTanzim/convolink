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
        browser: matched.browser,
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
    // Never auto-select a profile without explicit user instruction
    return null;
  }

  // Interactive user prompt: all profiles are presented equally with no assumed ranking
  console.log("\n🧭 ConvoLink Setup: Which browser profile do you want active for this project (.convo/config.json)?\n");
  profiles.forEach((p, idx) => {
    const num = idx + 1;
    const emailTag = p.email ? ` <${p.email}>` : "";
    console.log(`  ${num}) [${p.browser}] ${p.name}${emailTag}`);
  });
  const otherIdx = profiles.length + 1;
  console.log(`  ${otherIdx}) Other (write custom profile path or email)`);
  console.log(`  0) Skip (cancel without setting profile)\n`);

  const prompt = options.promptInput ?? defaultPromptInput;
  const answer = (await prompt(`Select a profile [1-${profiles.length}], '${otherIdx}' for Other, or 'skip' [0]: `)).trim();
  if (!answer || answer === "0" || answer.toLowerCase() === "skip" || answer.toLowerCase() === "s") {
    console.log("⏩ Profile selection skipped.");
    return null;
  }

  const num = parseInt(answer, 10);
  if (!isNaN(num) && num >= 1 && num <= profiles.length) {
    const chosen = profiles[num - 1]!;
    const isGecko = chosen.browser.toLowerCase().includes("firefox") || chosen.browser.toLowerCase().includes("zen");
    const config: ConvoProjectConfig = {
      profileId: chosen.profileId,
      profileEmail: chosen.email,
      profilePath: chosen.userDataDir,
      browser: chosen.browser,
      transport: isGecko ? "firefox-bidi" : "raw-cdp",
    };
    await configService.updateConfig(config);

    console.log(`\n✅ Linked workspace to ${chosen.name} (${chosen.email || chosen.browser}). Saved to .convo/config.json.\n`);
    return config;
  }

  // Handle write-in custom path, email, or 'Other' option
  let customValue = answer;
  if (num === otherIdx) {
    customValue = (await prompt("Enter custom profile directory path or email: ")).trim();
    if (!customValue || customValue.toLowerCase() === "skip") {
      console.log("⏩ Profile selection skipped.");
      return null;
    }
  }

  const isEmail = customValue.includes("@");
  const isPath = customValue.startsWith("/") || customValue.startsWith("~") || customValue.startsWith(".");

  if (isEmail || isPath || num === otherIdx) {
    const config: ConvoProjectConfig = {
      profileId: "Custom",
      profileEmail: isEmail ? customValue : undefined,
      profilePath: isPath ? customValue : undefined,
      browser: "Custom",
    };
    await configService.updateConfig(config);
    console.log(`\n✅ Linked workspace to custom profile (${customValue}). Saved to .convo/config.json.\n`);
    return config;
  }

  console.error(`Invalid selection: ${answer}. Profile setup cancelled.`);
  return null;
}

export async function resolveLaunchProfile(
  config: ConvoProjectConfig | null,
  browserName?: string,
  discoveryService?: { getProfilesForBrowser: (b?: string) => Promise<DiscoveredProfile[]> },
): Promise<{ profilePath?: string; profileDirectory?: string }> {
  if (!browserName || !config?.browser) {
    return { profilePath: config?.profilePath, profileDirectory: config?.profileId };
  }
  const bLower = browserName.toLowerCase();
  const cLower = config.browser.toLowerCase();
  if (bLower.includes(cLower) || cLower.includes(bLower)) {
    return { profilePath: config.profilePath, profileDirectory: config.profileId };
  }

  const discovery = discoveryService ?? new BrowserDiscoveryService();
  const matching = await discovery.getProfilesForBrowser(browserName);
  const chosen = matching[0];
  return { profilePath: chosen?.userDataDir, profileDirectory: chosen?.profileId };
}
