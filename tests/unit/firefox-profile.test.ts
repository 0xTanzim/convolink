import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { inspectFirefoxProfile } from "../../src/adapters/browsers/firefox-profile.js";

function profileWithLock(target: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-ff-"));
  fs.symlinkSync(target, path.join(dir, "lock"));
  return dir;
}

describe("firefox profile lock", () => {
  it("reports the owning pid and that it is not debugging", () => {
    const dir = profileWithLock("host:+4242");
    const state = inspectFirefoxProfile(dir, {
      readCmdline: (pid) => `/usr/lib/firefox/firefox -profile ${dir} (pid ${pid})`,
    });

    expect(state).toEqual({ locked: true, pid: 4242, debugging: false });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("recognises an instance that already has a debug port", () => {
    const dir = profileWithLock("host:+4243");
    const state = inspectFirefoxProfile(dir, {
      readCmdline: () => "/usr/lib/firefox/firefox --remote-debugging-port=9223 -no-remote",
    });

    expect(state.locked).toBe(true);
    expect(state.debugging).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("treats a missing lock as free", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-ff-free-"));
    expect(inspectFirefoxProfile(dir)).toEqual({ locked: false, debugging: false });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("treats a dead owner as free instead of blocking forever", () => {
    const dir = profileWithLock("host:+999999");
    const state = inspectFirefoxProfile(dir, { readCmdline: () => null });
    expect(state.locked).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("ignores a corrupt lock file", () => {
    const dir = profileWithLock("garbage");
    expect(inspectFirefoxProfile(dir).locked).toBe(false);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
