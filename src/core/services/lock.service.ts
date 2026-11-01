import fs from "node:fs";
import path from "node:path";
import { HostEnv } from "../env/host-env.js";
import { LockAcquisitionError } from "../errors/bridge-errors.js";

export interface LockHandle {
  readonly targetId: string;
  readonly lockPath: string;
  readonly pid: number;
  readonly acquiredAt: string;
}

interface LockPayload {
  readonly pid: number;
  readonly targetId: string;
  readonly acquiredAt: string;
  readonly expiresAt: number;
}

export class LockService {
  public static readonly DEFAULT_TTL_MS = 180_000; // 180 seconds (3 minutes) per AGENTS.md §4.2

  /**
   * Acquires an exclusive mutex lock on a target browser tab.
   */
  public async acquireLock(targetId: string, ttlMs: number = LockService.DEFAULT_TTL_MS): Promise<LockHandle> {
    HostEnv.ensureDirs();
    const lockPath = HostEnv.getTabLockPath(targetId);
    if (fs.existsSync(lockPath)) {
      this.evaluateExistingLock(targetId, lockPath);
    }

    const payload: LockPayload = {
      pid: process.pid,
      targetId,
      acquiredAt: new Date().toISOString(),
      expiresAt: Date.now() + ttlMs,
    };

    try {
      fs.writeFileSync(lockPath, JSON.stringify(payload, null, 2), { flag: "wx", mode: 0o600 });
    } catch {
      throw new LockAcquisitionError(targetId, -1, lockPath);
    }

    return { targetId, lockPath, pid: process.pid, acquiredAt: payload.acquiredAt };
  }

  /**
   * Releases an acquired lock safely.
   */
  public async releaseLock(handle: LockHandle): Promise<void> {
    try {
      if (fs.existsSync(handle.lockPath)) fs.unlinkSync(handle.lockPath);
    } catch {}
  }

  /**
   * Checks whether a tab target is currently locked.
   */
  public isLocked(targetId: string): boolean {
    const lockPath = HostEnv.getTabLockPath(targetId);
    if (!fs.existsSync(lockPath)) return false;
    try {
      const payload: LockPayload = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      if (Date.now() > payload.expiresAt) return false;
      return this.isProcessAlive(payload.pid);
    } catch {
      return false;
    }
  }

  /**
   * Convenience wrapper that executes a routine while holding the tab lock.
   */
  public async withLock<T>(
    targetId: string,
    action: (handle: LockHandle) => Promise<T>,
    ttlMs: number = LockService.DEFAULT_TTL_MS,
  ): Promise<T> {
    const handle = await this.acquireLock(targetId, ttlMs);
    const intervalMs = Math.max(100, Math.floor(ttlMs / 3));
    const timer = setInterval(() => {
      this.renewLock(handle, ttlMs).catch(() => {});
    }, intervalMs);

    try {
      return await action(handle);
    } finally {
      clearInterval(timer);
      await this.releaseLock(handle);
    }
  }

  /**
   * Renews an active lock's lease TTL, preventing stale reclamation during long tasks.
   */
  public async renewLock(handle: LockHandle, extensionMs: number = LockService.DEFAULT_TTL_MS): Promise<void> {
    if (!fs.existsSync(handle.lockPath)) return;
    try {
      const payload: LockPayload = JSON.parse(fs.readFileSync(handle.lockPath, "utf8"));
      if (payload.pid !== process.pid) return;
      const updated: LockPayload = { ...payload, expiresAt: Date.now() + extensionMs };
      fs.writeFileSync(handle.lockPath, JSON.stringify(updated, null, 2), "utf8");
    } catch {}
  }

  /**
   * Evaluates an existing lock file to determine if it is valid or stale.
   */
  private evaluateExistingLock(targetId: string, lockPath: string): void {
    let payload: LockPayload | null = null;
    try {
      payload = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    } catch {
      console.warn(`[LockService] Reclaimed corrupt tab lock for target '${targetId}' at '${lockPath}'`);
      try { fs.unlinkSync(lockPath); } catch {}
      return;
    }

    if (!payload) return;
    const isExpired = Date.now() > payload.expiresAt;
    const isOwnerAlive = this.isProcessAlive(payload.pid);

    if (isExpired || !isOwnerAlive) {
      console.warn(`[LockService] Reclaimed stale tab lock for target '${targetId}' (held by pid ${payload.pid}, expired=${isExpired}, pidAlive=${isOwnerAlive})`);
      try { fs.unlinkSync(lockPath); } catch {}
      return;
    }

    throw new LockAcquisitionError(targetId, payload.pid, lockPath);
  }

  /**
   * Releases temporary tab locks matching process PID from the runtime lock directory.
   */
  public static cleanupProcessLocks(pid: number = process.pid): number {
    const lockDir = HostEnv.getLockDir();
    if (!fs.existsSync(lockDir)) return 0;
    let count = 0;
    try {
      const files = fs.readdirSync(lockDir);
      for (const file of files) {
        if (!file.startsWith("tab-") || !file.endsWith(".lock")) continue;
        const filePath = path.join(lockDir, file);
        try {
          const raw = fs.readFileSync(filePath, "utf8");
          const payload = JSON.parse(raw);
          if (payload?.pid === pid) {
            fs.unlinkSync(filePath);
            count++;
          }
        } catch {}
      }
    } catch {}
    return count;
  }

  public cleanupProcessLocks(pid?: number): number {
    return LockService.cleanupProcessLocks(pid);
  }

  /**
   * Checks if a process is still alive using POSIX signal 0.
   */
  private isProcessAlive(pid: number): boolean {
    if (pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: unknown) {
      const error = err as NodeJS.ErrnoException;
      // EPERM means process exists but we don't have permission to signal it
      return error.code === "EPERM";
    }
  }
}

