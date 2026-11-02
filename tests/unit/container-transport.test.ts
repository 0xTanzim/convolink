import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { createContainer } from "../../src/container.js";
import { loadResolution, requireResolution } from "../../src/entrypoints/config-context.js";

describe("createContainer Transport Auto-Resolution", () => {
  let sandboxDir: string;
  let convoDir: string;
  let configFile: string;

  beforeAll(() => {
    sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-transport-test-"));
    convoDir = path.join(sandboxDir, ".convo");
    configFile = path.join(convoDir, "config.json");
  });

  afterAll(() => {
    try {
      fs.rmSync(sandboxDir, { recursive: true, force: true });
    } catch {}
  });

  it("defaults to raw-cdp when no config exists", async () => {
    const container = createContainer();
    expect(container.browser.id).toBe("raw-cdp");
  });

  it("auto-selects firefox-bidi when .convo/config.json has Zen Browser", async () => {
    fs.mkdirSync(convoDir, { recursive: true });
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        browser: "Zen Browser",
        profilePath: "/home/user/.config/zen/uc3afs3u.Default (release)",
      }),
    );

    const resolved = requireResolution(await loadResolution({}, sandboxDir));
    const container = createContainer({ resolution: resolved });
    expect(container.browser.id).toBe("firefox-bidi");
  });

  it("auto-selects firefox-bidi when .convo/config.json has Firefox", async () => {
    fs.mkdirSync(convoDir, { recursive: true });
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        browser: "Firefox",
        profilePath: "/home/user/.mozilla/firefox/vnwp8i57.default-release",
      }),
    );

    const resolved = requireResolution(await loadResolution({}, sandboxDir));
    const container = createContainer({ resolution: resolved });
    expect(container.browser.id).toBe("firefox-bidi");
  });

  it("explicit transport option overrides .convo/config.json", () => {
    fs.mkdirSync(convoDir, { recursive: true });
    fs.writeFileSync(
      configFile,
      JSON.stringify({
        browser: "Zen Browser",
      }),
    );

    const container = createContainer({ workDir: sandboxDir, transport: "raw-cdp" });
    expect(container.browser.id).toBe("raw-cdp");
  });

  it("auto-selects firefox-bidi when options.browserName is firefox or zen", () => {
    if (fs.existsSync(configFile)) fs.rmSync(configFile, { force: true });
    const c1 = createContainer({ workDir: sandboxDir, browserName: "firefox" });
    expect(c1.browser.id).toBe("firefox-bidi");

    const c2 = createContainer({ workDir: sandboxDir, browserName: "zen" });
    expect(c2.browser.id).toBe("firefox-bidi");

    const c3 = createContainer({ workDir: sandboxDir, browserName: "chrome" });
    expect(c3.browser.id).toBe("raw-cdp");
  });
});
