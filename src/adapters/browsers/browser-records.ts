import * as fs from "node:fs";
import * as path from "node:path";
import { HostEnv } from "../../core/env/host-env.js";

export interface BrowserRecord {
  readonly pid: number;
  readonly profilePath: string;
  readonly endpoint: string;
  readonly startedAt: string;
}

function recordsDir(): string {
  return path.join(HostEnv.getLockDir(), "browsers");
}

function recordPath(profilePath: string): string {
  const safe = profilePath.replace(/[^a-zA-Z0-9]+/g, "-").slice(-80);
  return path.join(recordsDir(), `browser-${safe}.json`);
}

export function writeBrowserRecord(record: BrowserRecord): void {
  const target = recordPath(record.profilePath);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, JSON.stringify(record), { mode: 0o600 });
}

export function readBrowserRecords(): BrowserRecord[] {
  try {
    return fs.readdirSync(recordsDir())
      .filter((name) => name.startsWith("browser-") && name.endsWith(".json"))
      .flatMap((name) => {
        try {
          return [JSON.parse(fs.readFileSync(path.join(recordsDir(), name), "utf8")) as BrowserRecord];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

export function removeBrowserRecord(profilePath: string): void {
  try {
    fs.rmSync(recordPath(profilePath), { force: true });
  } catch {}
}
