import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  describeBrowser,
  discoverBrowsers,
  listBrowsers,
  searchLocations,
} from "../../src/adapters/browsers/browser-catalog.js";
import { listProfiles } from "../../src/adapters/browsers/profile-catalog.js";

describe("browser catalog", () => {
  it("classifies Chromium-family browsers as dedicated-profile-only", () => {
    for (const id of ["chrome", "brave", "edge", "chromium"] as const) {
      const descriptor = describeBrowser(id);
      expect(descriptor.debugSupport).toBe("dedicated-profile-only");
      expect(descriptor.family).toBe("chromium");
    }
  });

  it("classifies Gecko browsers as single-session", () => {
    for (const id of ["firefox", "zen"] as const) {
      expect(describeBrowser(id).debugSupport).toBe("single-session");
      expect(describeBrowser(id).family).toBe("firefox");
    }
  });

  it("lists exactly the supported browsers", () => {
    expect(listBrowsers().map((b) => b.id).sort()).toEqual(
      ["brave", "chrome", "chromium", "edge", "firefox", "zen"],
    );
  });

  it("reports only installed browsers", async () => {
    const installed = await discoverBrowsers({
      locator: (id) => (id === "firefox" ? "/usr/lib/firefox/firefox" : `/usr/bin/${id}`),
      exists: (candidate) => candidate.includes("/firefox"),
    });
    expect(installed.map((b) => b.descriptor.id)).toEqual(["firefox"]);
  });

  it("searches a known set of locations", () => {
    expect(searchLocations().length).toBeGreaterThan(0);
  });
});

describe("profile catalog", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "convo-catalog-"));

  it("marks a dedicated Chromium profile as debuggable and a default one as not", async () => {
    const profiles = await listProfiles("chrome", {
      discover: async () => [
        { browser: "chrome", profileId: "Default", name: "Default", email: "", userDataDir: "/c/Default" },
        { browser: "chrome", profileId: "Profile 1", name: "Work", email: "", userDataDir: "/c/Profile 1" },
      ],
    });

    expect(profiles[0]?.isDefault).toBe(true);
    expect(profiles[0]?.debuggable).toBe(false);
    expect(profiles[1]?.isDefault).toBe(false);
    expect(profiles[1]?.debuggable).toBe(true);
    expect(profiles[1]?.requiresDedicatedProfile).toBe(true);
  });

  it("marks a locked Gecko profile as not debuggable and reports the owning pid", async () => {
    fs.symlinkSync(`host:+${process.pid}`, path.join(tmp, "lock"));
    const profiles = await listProfiles("firefox", {
      discover: async () => [
        { browser: "firefox", profileId: "rel", name: "default-release", email: "", userDataDir: tmp },
      ],
      readCmdline: () => "/usr/lib/firefox/firefox -profile /x",
    });

    expect(profiles[0]?.isDefault).toBe(true);
    expect(profiles[0]?.debuggable).toBe(false);
    expect(profiles[0]?.lockOwnerPid).toBe(process.pid);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
