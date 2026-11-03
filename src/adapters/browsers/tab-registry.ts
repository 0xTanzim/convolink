import * as fs from "node:fs";
import * as path from "node:path";
import { HostEnv } from "../../core/env/host-env.js";

export interface ManagedTabRecord {
  readonly targetId: string;
  readonly platform: string;
  readonly url: string;
  readonly threadId: string | null;
  readonly createdAt: string;
}

const FILE = "tabs.json";

function registryPath(): string {
  return path.join(HostEnv.getLockDir(), FILE);
}

function readAll(): ManagedTabRecord[] {
  try {
    const parsed = JSON.parse(fs.readFileSync(registryPath(), "utf8"));
    return Array.isArray(parsed) ? (parsed as ManagedTabRecord[]) : [];
  } catch {
    return [];
  }
}

function writeAll(records: readonly ManagedTabRecord[]): void {
  const target = registryPath();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  fs.writeFileSync(target, JSON.stringify(records.slice(-200), null, 2), { mode: 0o600 });
}

/**
 * Only tabs ConvoLink opened are safe to reuse, reset, or reload. Anything the
 * user opened is foreign until they name it with a thread URL or target id.
 */
export function recordManagedTab(record: ManagedTabRecord): void {
  const others = readAll().filter((existing) => existing.targetId !== record.targetId);
  writeAll([...others, record]);
}

export function forgetManagedTab(targetId: string): void {
  writeAll(readAll().filter((record) => record.targetId !== targetId));
}

export function isManagedTab(targetId: string): boolean {
  return readAll().some((record) => record.targetId === targetId);
}

export interface TabRef {
  readonly targetId: string;
  readonly url: string;
  readonly threadId: string | null;
}

/**
 * A tab is ConvoLink's only when its id is recorded or it carries the same
 * conversation. URL equality is deliberately excluded: platform roots such as
 * https://chatgpt.com/ repeat across unrelated user tabs, and matching on the
 * URL reported a hand-opened tab as managed.
 */
/** Root URLs have no conversation, and the placeholder they share is not an identity. */
const PLACEHOLDER_THREADS = new Set(["default", "unknown", "none", "null", ""]);

function realThreadId(threadId: string | null | undefined): string | null {
  if (!threadId) return null;
  const normalized = threadId.trim().toLowerCase();
  return PLACEHOLDER_THREADS.has(normalized) ? null : threadId;
}

export function matchesManagedRecord(record: ManagedTabRecord, ref: TabRef): boolean {
  if (record.targetId === ref.targetId) return true;
  const wanted = realThreadId(ref.threadId);
  if (!wanted) return false;
  return realThreadId(record.threadId) === wanted;
}

export function isManagedTabRef(ref: TabRef): boolean {
  return readAll().some((record) => matchesManagedRecord(record, ref));
}

export function managedTabIds(): Set<string> {
  return new Set(readAll().map((record) => record.targetId));
}

export function managedTabForPlatform(platform: string): ManagedTabRecord | null {
  const matches = readAll().filter((record) => record.platform === platform);
  return matches.length > 0 ? matches[matches.length - 1]! : null;
}

export function clearManagedTabs(): void {
  try {
    fs.rmSync(registryPath(), { force: true });
  } catch {}
}
