import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { LockAcquisitionError } from "../../src/core/errors/bridge-errors.js";
import { LockService } from "../../src/core/services/lock.service.js";

describe("LockService", () => {
  const testDir = path.join(os.tmpdir(), "omni-bridge-test-locks-" + Math.random().toString(36).slice(2));

  beforeEach(() => {
    process.env.XDG_RUNTIME_DIR = testDir;
    fs.mkdirSync(testDir, { recursive: true, mode: 0o700 });
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
    delete process.env.XDG_RUNTIME_DIR;
  });

  it("acquires and releases an uncontested lock", async () => {
    const lockService = new LockService();
    const handle = await lockService.acquireLock("target-1");
    expect(handle.targetId).toBe("target-1");
    expect(fs.existsSync(handle.lockPath)).toBe(true);

    await lockService.releaseLock(handle);
    expect(fs.existsSync(handle.lockPath)).toBe(false);
  });

  it("throws LockAcquisitionError when lock is held by current active process", async () => {
    const lockService = new LockService();
    const handle = await lockService.acquireLock("target-2");

    await expect(lockService.acquireLock("target-2")).rejects.toBeInstanceOf(LockAcquisitionError);

    await lockService.releaseLock(handle);
  });

  it("reclaims stale lock when holding PID is dead", async () => {
    const lockService = new LockService();
    const lockPath = path.join(testDir, "omni-bridge", "tab-target-dead.lock");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    // Use a PID that is virtually guaranteed to not exist (e.g. 9999999)
    const deadPayload = {
      pid: 9999999,
      targetId: "target-dead",
      acquiredAt: new Date(Date.now() - 5000).toISOString(),
      expiresAt: Date.now() + 60000,
    };
    fs.writeFileSync(lockPath, JSON.stringify(deadPayload), "utf8");

    // Should detect dead PID and successfully reclaim
    const handle = await lockService.acquireLock("target-dead");
    expect(handle.targetId).toBe("target-dead");
    expect(fs.existsSync(handle.lockPath)).toBe(true);

    await lockService.releaseLock(handle);
  });

  it("reclaims expired lock even if PID check is inconclusive", async () => {
    const lockService = new LockService();
    const lockPath = path.join(testDir, "omni-bridge", "tab-target-expired.lock");
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });

    const expiredPayload = {
      pid: process.pid,
      targetId: "target-expired",
      acquiredAt: new Date(Date.now() - 200000).toISOString(),
      expiresAt: Date.now() - 1000, // expired
    };
    fs.writeFileSync(lockPath, JSON.stringify(expiredPayload), "utf8");

    const handle = await lockService.acquireLock("target-expired");
    expect(handle.targetId).toBe("target-expired");

    await lockService.releaseLock(handle);
  });

  it("executes work within withLock wrapper and releases automatically", async () => {
    const lockService = new LockService();
    let executed = false;

    const result = await lockService.withLock("target-wrap", async () => {
      executed = true;
      return 42;
    });

    expect(executed).toBe(true);
    expect(result).toBe(42);
    expect(lockService.isLocked("target-wrap")).toBe(false);
  });
});
