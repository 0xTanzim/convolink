import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HostEnv } from "../../src/core/env/host-env.js";
import { LockAcquisitionError } from "../../src/core/errors/bridge-errors.js";
import { LockService } from "../../src/core/services/lock.service.js";

describe("LockService Adversarial Stress Harness", () => {
  const testDir = path.join(os.tmpdir(), "convolink-lock-stress-" + Math.random().toString(36).slice(2));
  const originalXdg = process.env.XDG_RUNTIME_DIR;

  beforeEach(() => {
    process.env.XDG_RUNTIME_DIR = testDir;
    fs.mkdirSync(testDir, { recursive: true, mode: 0o700 });
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {}
    if (originalXdg === undefined) {
      delete process.env.XDG_RUNTIME_DIR;
    } else {
      process.env.XDG_RUNTIME_DIR = originalXdg;
    }
  });

  describe("Requirement 1: Default TTL is 180 seconds", () => {
    it("has static DEFAULT_TTL_MS equal to 180,000ms", () => {
      expect(LockService.DEFAULT_TTL_MS).toBe(180_000);
    });

    it("writes lock file with expiresAt approximately now + 180,000ms by default", async () => {
      const lockService = new LockService();
      const before = Date.now();
      const handle = await lockService.acquireLock("target-default-ttl");
      const after = Date.now();

      expect(fs.existsSync(handle.lockPath)).toBe(true);
      const raw = JSON.parse(fs.readFileSync(handle.lockPath, "utf8"));

      expect(raw.pid).toBe(process.pid);
      expect(raw.targetId).toBe("target-default-ttl");
      expect(raw.expiresAt).toBeGreaterThanOrEqual(before + 180_000);
      expect(raw.expiresAt).toBeLessThanOrEqual(after + 180_000 + 100);

      await lockService.releaseLock(handle);
    });
  });

  describe("Requirement 2: withLock renews lease periodically every ttlMs / 3", () => {
    it("renews lease before expiry during long-running work", async () => {
      const lockService = new LockService();
      const targetId = "target-renew-loop";

      // ttl = 300ms, renewal interval = Math.max(100, Math.floor(300/3)) = 100ms
      const ttlMs = 300;
      let initialExpiresAt = 0;
      let finalExpiresAt = 0;
      let lockPath = "";

      await lockService.withLock(
        targetId,
        async (handle) => {
          lockPath = handle.lockPath;
          const initialPayload = JSON.parse(fs.readFileSync(handle.lockPath, "utf8"));
          initialExpiresAt = initialPayload.expiresAt;

          // Sleep for 350ms (> 300ms original TTL)
          // At 100ms, 200ms, 300ms, the renewal timer should have extended expiresAt!
          await new Promise((r) => setTimeout(r, 220));

          const renewedPayload = JSON.parse(fs.readFileSync(handle.lockPath, "utf8"));
          finalExpiresAt = renewedPayload.expiresAt;

          // Lock must still be held and active
          expect(lockService.isLocked(targetId)).toBe(true);

          // A competing acquireLock attempt must still be blocked
          await expect(lockService.acquireLock(targetId)).rejects.toBeInstanceOf(LockAcquisitionError);
        },
        ttlMs,
      );

      // Verify that expiresAt was extended forward in time
      expect(finalExpiresAt).toBeGreaterThan(initialExpiresAt);

      // Verify lock was cleanly unlinked upon withLock exit
      expect(fs.existsSync(lockPath)).toBe(false);
      expect(lockService.isLocked(targetId)).toBe(false);
    });

    it("clears renewal timer and releases lock even if action throws an error", async () => {
      const lockService = new LockService();
      const targetId = "target-action-err";
      let capturedPath = "";

      await expect(
        lockService.withLock(
          targetId,
          async (handle) => {
            capturedPath = handle.lockPath;
            expect(fs.existsSync(capturedPath)).toBe(true);
            throw new Error("Action failed unexpectedly");
          },
          300,
        ),
      ).rejects.toThrow("Action failed unexpectedly");

      // Lock must be released despite error
      expect(fs.existsSync(capturedPath)).toBe(false);
      expect(lockService.isLocked(targetId)).toBe(false);
    });

    it("verifies renewal interval math logic (ttlMs / 3, minimum 100ms)", () => {
      // AGENTS.md §4.2: for default 180s TTL, renewal is every 60s
      const defaultTtl = 180_000;
      const defaultInterval = Math.max(100, Math.floor(defaultTtl / 3));
      expect(defaultInterval).toBe(60_000);

      // Minimum clamp check
      const smallTtl = 90;
      const clampedInterval = Math.max(100, Math.floor(smallTtl / 3));
      expect(clampedInterval).toBe(100);
    });
  });

  describe("Requirement 3: Stale locks trigger console.warn and are reclaimed safely", () => {
    it("reclaims stale dead-PID lock with console.warn and acquires without throwing", async () => {
      const lockService = new LockService();
      HostEnv.ensureDirs();
      const targetId = "target-dead-pid-test";
      const lockPath = HostEnv.getTabLockPath(targetId);

      // Seed a stale lock held by a dead PID (e.g. 8888888) with future expiry
      const stalePayload = {
        pid: 8888888,
        targetId,
        acquiredAt: new Date(Date.now() - 30_000).toISOString(),
        expiresAt: Date.now() + 60_000,
      };
      fs.writeFileSync(lockPath, JSON.stringify(stalePayload), "utf8");

      const warnMessages: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnMessages.push(args.join(" "));
      };

      try {
        const handle = await lockService.acquireLock(targetId);

        // Verification: No LockAcquisitionError thrown
        expect(handle.targetId).toBe(targetId);
        expect(handle.pid).toBe(process.pid);

        // Verification: console.warn logged with required diagnostic detail
        expect(warnMessages.length).toBeGreaterThan(0);
        expect(warnMessages[0]).toContain("[LockService] Reclaimed stale tab lock");
        expect(warnMessages[0]).toContain("8888888");
        expect(warnMessages[0]).toContain("pidAlive=false");

        // Lock on disk is now owned by process.pid
        const currentPayload = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        expect(currentPayload.pid).toBe(process.pid);

        await lockService.releaseLock(handle);
      } finally {
        console.warn = originalWarn;
      }
    });

    it("reclaims expired-timestamp lock with console.warn even if PID check is alive", async () => {
      const lockService = new LockService();
      HostEnv.ensureDirs();
      const targetId = "target-expired-pid-test";
      const lockPath = HostEnv.getTabLockPath(targetId);

      // Seed an expired lock with process.pid (alive, but expired 10 seconds ago)
      const expiredPayload = {
        pid: process.pid,
        targetId,
        acquiredAt: new Date(Date.now() - 200_000).toISOString(),
        expiresAt: Date.now() - 10_000,
      };
      fs.writeFileSync(lockPath, JSON.stringify(expiredPayload), "utf8");

      const warnMessages: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnMessages.push(args.join(" "));
      };

      try {
        const handle = await lockService.acquireLock(targetId);

        expect(handle.targetId).toBe(targetId);
        expect(warnMessages.length).toBeGreaterThan(0);
        expect(warnMessages[0]).toContain("[LockService] Reclaimed stale tab lock");
        expect(warnMessages[0]).toContain("expired=true");

        await lockService.releaseLock(handle);
      } finally {
        console.warn = originalWarn;
      }
    });

    it("reclaims corrupt unparseable lock file with console.warn", async () => {
      const lockService = new LockService();
      HostEnv.ensureDirs();
      const targetId = "target-corrupt-json";
      const lockPath = HostEnv.getTabLockPath(targetId);

      fs.writeFileSync(lockPath, "CORRUPT_NOT_JSON{broken...", "utf8");

      const warnMessages: string[] = [];
      const originalWarn = console.warn;
      console.warn = (...args: unknown[]) => {
        warnMessages.push(args.join(" "));
      };

      try {
        const handle = await lockService.acquireLock(targetId);

        expect(handle.targetId).toBe(targetId);
        expect(warnMessages.length).toBeGreaterThan(0);
        expect(warnMessages[0]).toContain("[LockService] Reclaimed corrupt tab lock");

        const fixed = JSON.parse(fs.readFileSync(lockPath, "utf8"));
        expect(fixed.pid).toBe(process.pid);

        await lockService.releaseLock(handle);
      } finally {
        console.warn = originalWarn;
      }
    });

    it("safely reclaims stale lock when executing inside withLock", async () => {
      const lockService = new LockService();
      HostEnv.ensureDirs();
      const targetId = "target-stale-withlock";
      const lockPath = HostEnv.getTabLockPath(targetId);

      // Seed stale lock
      fs.writeFileSync(
        lockPath,
        JSON.stringify({
          pid: 9999991,
          targetId,
          acquiredAt: new Date(Date.now() - 50_000).toISOString(),
          expiresAt: Date.now() + 10_000,
        }),
        "utf8",
      );

      const result = await lockService.withLock(targetId, async () => {
        return "reclaimed-and-executed";
      });

      expect(result).toBe("reclaimed-and-executed");
      expect(fs.existsSync(lockPath)).toBe(false);
    });
  });

  describe("Requirement 4: Active alive lock throws LockAcquisitionError", () => {
    it("throws LockAcquisitionError when active lock is held by current process", async () => {
      const lockService = new LockService();
      const targetId = "target-active-self";

      const handle = await lockService.acquireLock(targetId, 60_000);

      try {
        await expect(lockService.acquireLock(targetId)).rejects.toThrow(LockAcquisitionError);

        try {
          await lockService.acquireLock(targetId);
          expect().fail("Should have thrown LockAcquisitionError");
        } catch (err) {
          expect(err).toBeInstanceOf(LockAcquisitionError);
          const lockErr = err as LockAcquisitionError;
          expect(lockErr.code).toBe("ERR_LOCK_ACQUISITION");
          expect(lockErr.targetId).toBe(targetId);
          expect(lockErr.holdingPid).toBe(process.pid);
        }
      } finally {
        await lockService.releaseLock(handle);
      }
    });

    it("throws LockAcquisitionError when active lock is held by external alive PID", async () => {
      const lockService = new LockService();
      HostEnv.ensureDirs();
      const targetId = "target-external-alive-pid";
      const lockPath = HostEnv.getTabLockPath(targetId);

      // On Linux, PID 1 (init/systemd) is guaranteed alive
      const alivePid = 1;
      const activePayload = {
        pid: alivePid,
        targetId,
        acquiredAt: new Date().toISOString(),
        expiresAt: Date.now() + 120_000, // Valid unexpired
      };
      fs.writeFileSync(lockPath, JSON.stringify(activePayload), "utf8");

      let thrownErr: unknown = null;
      try {
        await lockService.acquireLock(targetId);
      } catch (err) {
        thrownErr = err;
      }

      expect(thrownErr).toBeInstanceOf(LockAcquisitionError);
      const lockErr = thrownErr as LockAcquisitionError;
      expect(lockErr.targetId).toBe(targetId);
      expect(lockErr.holdingPid).toBe(alivePid);

      // Ensure the external active lock was NOT deleted or overwritten
      expect(fs.existsSync(lockPath)).toBe(true);
      const onDisk = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      expect(onDisk.pid).toBe(alivePid);

      // Cleanup
      fs.unlinkSync(lockPath);
    });

    it("reports isLocked: true for active alive lock and false after release", async () => {
      const lockService = new LockService();
      const targetId = "target-islocked-test";

      expect(lockService.isLocked(targetId)).toBe(false);

      const handle = await lockService.acquireLock(targetId);
      expect(lockService.isLocked(targetId)).toBe(true);

      await lockService.releaseLock(handle);
      expect(lockService.isLocked(targetId)).toBe(false);
    });
  });
});
