import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { OsProcessProbe } from "../../src/adapters/browsers/process-probe.js";
import { readBrowserRecords, removeBrowserRecord, writeBrowserRecord } from "../../src/adapters/browsers/browser-records.js";
import { GhostCleanupService } from "../../src/adapters/browsers/ghost-cleanup.js";

const runtime = fs.mkdtempSync(path.join(os.tmpdir(), "convo-runtime-"));
process.env.XDG_RUNTIME_DIR = runtime;

describe("OsProcessProbe", () => {
  it("reports the current process as alive and dead pids as gone", () => {
    const probe = new OsProcessProbe();
    expect(probe.isAlive(process.pid)).toBe(true);
    expect(probe.isAlive(999_999)).toBe(false);
    expect(probe.isAlive(0)).toBe(false);
  });

  it("returns a command line for a live process", () => {
    const probe = new OsProcessProbe();
    const cmdline = probe.cmdline(process.pid);
    if (process.platform === "linux") expect(cmdline).toContain("bun");
  });
});

describe("browser launch records", () => {
  it("round-trips a record", () => {
    writeBrowserRecord({
      pid: process.pid,
      profilePath: "/tmp/convo-profile-a",
      endpoint: "127.0.0.1:9222",
      startedAt: new Date().toISOString(),
    });
    expect(readBrowserRecords().some((record) => record.profilePath === "/tmp/convo-profile-a")).toBe(true);
    removeBrowserRecord("/tmp/convo-profile-a");
  });
});

describe("ghost cleanup", () => {
  it("kills only a recorded, live process whose cmdline matches its profile", async () => {
    writeBrowserRecord({
      pid: 4242,
      profilePath: "/tmp/convo-ghost-profile",
      endpoint: "127.0.0.1:9222",
      startedAt: new Date().toISOString(),
    });

    const killed: number[] = [];
    const service = new GhostCleanupService();
    const count = await service.killGhostProcesses(
      { isAlive: () => true, cmdline: () => "chrome --user-data-dir=/tmp/convo-ghost-profile" },
      (pid) => killed.push(pid),
    );

    expect(count).toBe(1);
    expect(killed).toEqual([4242]);
  });

  it("drops a stale record without killing anything", async () => {
    writeBrowserRecord({
      pid: 4343,
      profilePath: "/tmp/convo-stale-profile",
      endpoint: "127.0.0.1:9222",
      startedAt: new Date().toISOString(),
    });

    const killed: number[] = [];
    const count = await new GhostCleanupService().killGhostProcesses(
      { isAlive: () => false, cmdline: () => null },
      (pid) => killed.push(pid),
    );

    expect(count).toBe(0);
    expect(killed).toEqual([]);
    expect(readBrowserRecords().some((record) => record.pid === 4343)).toBe(false);
  });
});
