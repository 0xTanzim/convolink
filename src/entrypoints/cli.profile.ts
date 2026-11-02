import { BrowserDiscoveryService } from "../adapters/browsers/browser-discovery.js";
import { ConfigService } from "../core/services/config.service.js";
import { ProjectConfigAdapter } from "../adapters/config/project-config.adapter.js";

export async function handleProfile(args: string[]): Promise<number> {
  const sub = args[0] || "list";
  const configService = new ConfigService(new ProjectConfigAdapter());
  const currentConfig = await configService.loadConfig();
  const discovery = new BrowserDiscoveryService();
  const profiles = await discovery.discoverProfiles();

  if (sub === "list") {
    if (args.includes("--json") || args.includes("-j")) {
      const jsonList = profiles.map((p, i) => {
        const isActive = currentConfig?.profilePath
          ? p.userDataDir === currentConfig.profilePath
          : Boolean(currentConfig?.profileEmail && p.email === currentConfig.profileEmail);
        return {
          index: i + 1,
          browser: p.browser,
          name: p.name,
          email: p.email,
          profileId: p.profileId,
          userDataDir: p.userDataDir,
          isActive,
        };
      });
      console.log(JSON.stringify(jsonList, null, 2));
      return 0;
    }

    console.log("📁 Discovered Browser Profiles:\n");
    profiles.forEach((p, i) => {
      const idx = i + 1;
      const isActive = currentConfig?.profilePath
        ? p.userDataDir === currentConfig.profilePath
        : Boolean(currentConfig?.profileEmail && p.email === currentConfig.profileEmail);
      const activeBadge = isActive ? " [★ ACTIVE IN THIS REPO]" : "";
      const email = p.email ? ` <${p.email}>` : "";
      console.log(`  #${idx} [${p.browser}] ${p.name}${email}${activeBadge}`);
      console.log(`     Path: ${p.userDataDir}`);
    });
    console.log("\n💡 To set active profile for this project: convo profile select <number|email> (e.g. convo profile select 1)");
    return 0;
  }

  if (sub === "select") {
    const target = args[1];
    if (!target) {
      console.error("Error: Please provide profile number, name, or email to select (e.g. convo profile select 1).");
      console.error("💡 Tip: If using #, pass '1' or quote '#1' so bash does not treat '#' as a comment.");
      return 1;
    }

    const idxMatch = target.match(/^#?(\d+)$/);
    let matched = idxMatch && idxMatch[1] ? profiles[parseInt(idxMatch[1], 10) - 1] : undefined;

    if (!matched) {
      const lower = target.toLowerCase();
      matched = profiles.find(
        (p) => p.email.toLowerCase().includes(lower) || p.name.toLowerCase().includes(lower) || p.browser.toLowerCase().includes(lower),
      );
    }

    if (!matched) {
      console.error(`❌ Profile matching '${target}' not found. Run 'convo profile list' to see available profiles.`);
      return 1;
    }

    const isGecko = matched.browser.toLowerCase().includes("firefox") || matched.browser.toLowerCase().includes("zen");
    await configService.updateConfig({
      profileId: matched.profileId,
      profilePath: matched.userDataDir,
      browser: matched.browser,
      transport: isGecko ? "firefox-bidi" : "raw-cdp",
    });

    const email = matched.email ? ` <${matched.email}>` : "";
    console.log(`✅ Saved active profile for this repository into .convo/config.json:`);
    console.log(`   ${matched.name}${email} (${matched.browser})`);
    return 0;
  }

  console.error(`Unknown profile subcommand: ${sub}. Available: list, select`);
  return 1;
}
