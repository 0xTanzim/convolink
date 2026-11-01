import { describe, expect, it } from "bun:test";
import { BrowserDiscoveryService } from "../../src/adapters/browsers/browser-discovery.js";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

describe("BrowserDiscoveryService", () => {
  const tmpDir = path.join(os.tmpdir(), `convo-discovery-test-${Date.now()}`);

  it("extracts profile accounts and names from Chrome Local State JSON", async () => {
    const fakeUserData = path.join(tmpDir, "google-chrome");
    fs.mkdirSync(fakeUserData, { recursive: true });

    const localState = {
      profile: {
        info_cache: {
          Default: {
            name: "Work Profile",
            user_name: "dev@work.corp",
            gaia_name: "Engineer",
          },
          "Profile 1": {
            name: "Personal",
            user_name: "tanzim@gmail.com",
            gaia_name: "Tanzim H",
          },
        },
      },
    };
    fs.writeFileSync(path.join(fakeUserData, "Local State"), JSON.stringify(localState));

    const discovery = new BrowserDiscoveryService([fakeUserData]);
    const profiles = await discovery.discoverProfiles();

    expect(profiles.length).toBe(2);
    const work = profiles.find((p) => p.profileId === "Default");
    expect(work).toBeDefined();
    expect(work?.name).toBe("Work Profile");
    expect(work?.email).toBe("dev@work.corp");

    const personal = profiles.find((p) => p.profileId === "Profile 1");
    expect(personal).toBeDefined();
    expect(personal?.name).toBe("Personal");
    expect(personal?.email).toBe("tanzim@gmail.com");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("parses DevToolsActivePort correctly", async () => {
    const fakeUserData = path.join(tmpDir, "active-port-test");
    fs.mkdirSync(fakeUserData, { recursive: true });

    fs.writeFileSync(path.join(fakeUserData, "DevToolsActivePort"), "9222\n/devtools/browser/abc-123\n");

    const discovery = new BrowserDiscoveryService([fakeUserData]);
    const portInfo = await discovery.readDevToolsActivePort(fakeUserData);

    expect(portInfo).toBeDefined();
    expect(portInfo?.port).toBe(9222);
    expect(portInfo?.browserWsPath).toBe("/devtools/browser/abc-123");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when DevToolsActivePort is missing or corrupted", async () => {
    const fakeUserData = path.join(tmpDir, "corrupted-port-test");
    fs.mkdirSync(fakeUserData, { recursive: true });

    const discovery = new BrowserDiscoveryService([fakeUserData]);
    const missing = await discovery.readDevToolsActivePort(fakeUserData);
    expect(missing).toBeNull();

    fs.writeFileSync(path.join(fakeUserData, "DevToolsActivePort"), "not-a-port\n");
    const corrupted = await discovery.readDevToolsActivePort(fakeUserData);
    expect(corrupted).toBeNull();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
