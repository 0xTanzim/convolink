import { BrowserDiscoveryService } from "../adapters/browsers/browser-discovery.js";
import { BrowserLauncherService } from "../adapters/browsers/browser-launcher.js";
import { inspectFirefoxProfile } from "../adapters/browsers/firefox-profile.js";
import { loadResolution } from "./config-context.js";

const DEFAULT_BIDI_PORT = 9223;
const KILL_WAIT_MS = 250;
const KILL_WAIT_TRIES = 40;

/**
 * Gecko browsers (Firefox, Zen) expose WebDriver BiDi only when started with
 * a debug port, and a profile can be held by one process. So ConvoLink either
 * starts the browser on the real profile, or refuses — it never opens a second,
 * empty instance.
 */
export async function handleFirefoxConnect(args: string[] = []): Promise<number> {
  const isZenFlag = args.includes("--zen");
  const isFirefoxFlag = args.includes("--firefox");

  let targetBrowser: "firefox" | "zen" = isZenFlag ? "zen" : "firefox";

  if (!isZenFlag && !isFirefoxFlag) {
    const res = await loadResolution();
    if (res.ok && res.value.browserId === "zen") {
      targetBrowser = "zen";
    } else if (res.ok && res.value.browserId === "firefox") {
      targetBrowser = "firefox";
    } else {
      console.error("Usage: convo connect [--zen|--firefox] [--restart] [--port=9223]");
      console.error("  --restart  close the already-open browser and reopen the same profile with BiDi");
      return 1;
    }
  }

  const browserLabel = targetBrowser === "zen" ? "Zen Browser" : "Firefox";
  const restart = args.includes("--restart");
  const portArg = args.find((a) => a.startsWith("--port="))?.split("=")[1];
  const port = portArg ? Number(portArg) : DEFAULT_BIDI_PORT;

  const profiles = await new BrowserDiscoveryService().getProfilesForBrowser(targetBrowser);
  const profile = profiles.find((p) => p.email) ?? profiles[0];
  if (!profile) {
    console.error(`❌ No ${browserLabel} profile found on this machine.`);
    return 1;
  }

  const lock = inspectFirefoxProfile(profile.userDataDir);
  if (lock.locked && !lock.debugging && !restart) {
    console.error(`❌ ${browserLabel} is already open (pid ${lock.pid}) without remote debugging.`);
    console.error(`   ${browserLabel} only enables BiDi in the process that starts it, and one profile can only be held once.`);
    console.error("   Re-run with --restart: it closes that window and reopens the same profile — your logins stay.");
    return 1;
  }

  if (restart && lock.locked) {
    if (lock.pid) {
      try {
        process.kill(lock.pid, "SIGKILL");
      } catch {}
    }
    for (let i = 0; i < KILL_WAIT_TRIES; i++) {
      if (!inspectFirefoxProfile(profile.userDataDir).locked) break;
      await new Promise((resolve) => setTimeout(resolve, KILL_WAIT_MS));
    }
  }

  const started = await new BrowserLauncherService().ensureBrowserRunning({
    profilePath: profile.userDataDir,
    browser: targetBrowser,
    port,
    timeoutMs: 25_000,
  });

  if (!started) {
    console.error(`❌ ${browserLabel} did not provide a debugging port on this profile.`);
    console.error(`   Close any other ${browserLabel} window, then retry.`);
    return 1;
  }

  const icon = targetBrowser === "zen" ? "🌀" : "🦊";
  console.log(`\n${icon} ${browserLabel} ready on your real profile: ${profile.userDataDir}`);
  console.log(`   BiDi: ws://127.0.0.1:${port}/session`);
  console.log("   Same cookies and logins — no new instance, no extension.");
  console.log(`\nNext: convo ask -p deepseek "hello" --transport firefox-bidi`);
  return 0;
}
