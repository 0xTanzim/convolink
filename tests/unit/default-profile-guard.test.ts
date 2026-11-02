import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DEFAULT_PROFILE_DIRS,
  isDefaultProfileEndpoint,
} from "../../src/adapters/browsers/default-profile-guard.js";

function makeHome(files: Record<string, string>): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "convo-guard-"));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(home, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return home;
}

describe("default profile guard", () => {
  it("detects the default profile's advertised debug port", () => {
    const home = makeHome({ ".config/google-chrome/DevToolsActivePort": "9222\n/devtools/browser/abc\n" });

    expect(isDefaultProfileEndpoint(9222, { home })).toBe(true);
    expect(isDefaultProfileEndpoint(9223, { home })).toBe(false);

    fs.rmSync(home, { recursive: true, force: true });
  });

  it("ignores other ports and missing markers", () => {
    const home = makeHome({});
    expect(isDefaultProfileEndpoint(9222, { home })).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("tolerates a corrupt marker instead of throwing", () => {
    const home = makeHome({ ".config/google-chrome/DevToolsActivePort": "not-a-port" });
    expect(isDefaultProfileEndpoint(9222, { home })).toBe(false);
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("covers the browsers ConvoLink can discover", () => {
    expect(DEFAULT_PROFILE_DIRS.some((dir) => dir.includes("google-chrome"))).toBe(true);
    expect(DEFAULT_PROFILE_DIRS.some((dir) => dir.includes("microsoft-edge"))).toBe(true);
  });
});
