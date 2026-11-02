import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { parseGeckoProfiles } from "../../src/adapters/browsers/gecko-profiles.js";
import { BrowserDiscoveryService } from "../../src/adapters/browsers/browser-discovery.js";

describe("GeckoProfiles Parser (Firefox & Zen Browser)", () => {
  const tmpRoot = path.join(os.tmpdir(), `gecko-test-${Date.now()}`);

  it("parses profiles.ini with relative paths and extracts signedInUser email", async () => {
    const firefoxRoot = path.join(tmpRoot, "firefox");
    const profileFolder = path.join(firefoxRoot, "vnwp8i57.default-release");
    fs.mkdirSync(profileFolder, { recursive: true });

    const iniContent = `
[Profile1]
Name=default
IsRelative=1
Path=2ap4vona.default
Default=0

[Profile0]
Name=default-release
IsRelative=1
Path=vnwp8i57.default-release
Default=1

[General]
StartWithLastProfile=1
Version=2

[Install11457493C5A56847]
Default=vnwp8i57.default-release
Locked=1
`;
    fs.writeFileSync(path.join(firefoxRoot, "profiles.ini"), iniContent);

    // Mock signedInUser.json
    fs.writeFileSync(
      path.join(profileFolder, "signedInUser.json"),
      JSON.stringify({
        version: 1,
        accountData: {
          email: "firefoxuser@example.com",
          uid: "abc1234",
        },
      }),
    );

    const profiles = await parseGeckoProfiles(firefoxRoot, "Firefox");
    expect(profiles.length).toBe(2);

    const release = profiles.find((p) => p.name === "default-release");
    expect(release).toBeDefined();
    expect(release?.browser).toBe("Firefox");
    expect(release?.email).toBe("firefoxuser@example.com");
    expect(release?.userDataDir).toBe(profileFolder);

    const def = profiles.find((p) => p.name === "default");
    expect(def).toBeDefined();
    expect(def?.email).toBe("");
    expect(def?.userDataDir).toBe(path.join(firefoxRoot, "2ap4vona.default"));

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("handles absolute paths when IsRelative=0", async () => {
    const zenRoot = path.join(tmpRoot, "zen");
    const absProfile = path.join(tmpRoot, "custom-zen-profile");
    fs.mkdirSync(zenRoot, { recursive: true });
    fs.mkdirSync(absProfile, { recursive: true });

    const iniContent = `
[Profile0]
Name=Zen Custom
IsRelative=0
Path=${absProfile}
Default=1
`;
    fs.writeFileSync(path.join(zenRoot, "profiles.ini"), iniContent);

    const profiles = await parseGeckoProfiles(zenRoot, "Zen Browser");
    expect(profiles.length).toBe(1);
    expect(profiles[0]?.browser).toBe("Zen Browser");
    expect(profiles[0]?.name).toBe("Zen Custom");
    expect(profiles[0]?.userDataDir).toBe(absProfile);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("returns empty array if profiles.ini is missing", async () => {
    const emptyDir = path.join(tmpRoot, "empty");
    fs.mkdirSync(emptyDir, { recursive: true });

    const profiles = await parseGeckoProfiles(emptyDir, "Firefox");
    expect(profiles).toEqual([]);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("BrowserDiscoveryService discovers Gecko profiles alongside Chrome profiles", async () => {
    const chromeDir = path.join(tmpRoot, "google-chrome");
    const zenDir = path.join(tmpRoot, "zen");
    fs.mkdirSync(chromeDir, { recursive: true });
    fs.mkdirSync(path.join(zenDir, "zen-prof"), { recursive: true });

    fs.writeFileSync(
      path.join(chromeDir, "Local State"),
      JSON.stringify({
        profile: {
          info_cache: {
            Default: { name: "Chrome Work", user_name: "work@chrome.corp" },
          },
        },
      }),
    );

    fs.writeFileSync(
      path.join(zenDir, "profiles.ini"),
      `[Profile0]\nName=Zen Personal\nIsRelative=1\nPath=zen-prof\n`,
    );

    const discovery = new BrowserDiscoveryService([chromeDir, zenDir]);
    const all = await discovery.discoverProfiles();

    expect(all.length).toBe(2);
    expect(all.some((p) => p.browser === "Google Chrome" && p.name === "Chrome Work")).toBe(true);
    expect(all.some((p) => p.browser === "Zen Browser" && p.name === "Zen Personal")).toBe(true);

    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });
});
