import { describe, expect, it } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { LockService } from "../../src/core/services/lock.service.js";
import { HostEnv } from "../../src/core/env/host-env.js";
import { LockAcquisitionError } from "../../src/core/errors/bridge-errors.js";

describe("LockService Hardening (Phase 1)", () => {
  const service = new LockService();

  it("acquires lock via atomic wx without pre-check TOCTOU races", async () => {
    const targetId = `test-atomic-${Date.now()}`;
    const handle = await service.acquireLock(targetId, 60_000);
    expect(handle.targetId).toBe(targetId);
    expect(fs.existsSync(handle.lockPath)).toBe(true);

    const payload = JSON.parse(fs.readFileSync(handle.lockPath, "utf8"));
    expect(payload.pid).toBe(process.pid);
    expect(payload.targetId).toBe(targetId);

    await service.releaseLock(handle);
    expect(fs.existsSync(handle.lockPath)).toBe(false);
  });

  it("does not release a lock if another process has claimed the file", async () => {
    const targetId = `test-release-ownership-${Date.now()}`;
    const handle = await service.acquireLock(targetId, 60_000);

    // Overwrite the lock file with another PID (simulating lock reassignment)
    const fakeForeignPayload = {
      pid: 9999999, // foreign pid
      targetId,
      acquiredAt: new Date(Date.now() + 1000).toISOString(),
      expiresAt: Date.now() + 60_000,
    };
    fs.writeFileSync(handle.lockPath, JSON.stringify(fakeForeignPayload, null, 2));

    // Current process tries to release its old handle
    await service.releaseLock(handle);

    // The lock file should NOT have been unlinked because PID didn't match!
    expect(fs.existsSync(handle.lockPath)).toBe(true);

    // Clean up
    fs.unlinkSync(handle.lockPath);
  });

  it("renews lock atomically without zero-byte truncation window", async () => {
    const targetId = `test-renew-atomic-${Date.now()}`;
    const handle = await service.acquireLock(targetId, 10_000);

    const beforePayload = JSON.parse(fs.readFileSync(handle.lockPath, "utf8"));
    await service.renewLock(handle, 120_000);

    // At no point should the lock file be invalid or empty
    const afterContent = fs.readFileSync(handle.lockPath, "utf8");
    expect(afterContent.length).toBeGreaterThan(10);
    const afterPayload = JSON.parse(afterContent);
    expect(afterPayload.expiresAt).toBeGreaterThan(beforePayload.expiresAt);

    await service.releaseLock(handle);
  });
});
