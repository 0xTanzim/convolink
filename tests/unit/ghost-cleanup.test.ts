import { describe, expect, it } from "bun:test";
import { GhostCleanupService } from "../../src/adapters/browsers/ghost-cleanup.js";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

describe("GhostCleanupService", () => {
  const tmpDir = path.join(os.tmpdir(), `convo-ghost-test-${Date.now()}`);

  it("identifies and purges ghost directory paths matching known patterns", async () => {
    const ghostDir1 = path.join(tmpDir, "convolink-ghost-1");
    const ghostDir2 = path.join(tmpDir, "chrome-debug-test");
    const safeUserDir = path.join(tmpDir, "safe-real-dir");

    fs.mkdirSync(ghostDir1, { recursive: true });
    fs.mkdirSync(ghostDir2, { recursive: true });
    fs.mkdirSync(safeUserDir, { recursive: true });

    const cleaner = new GhostCleanupService();
    const purged = await cleaner.purgeGhostDirectories([ghostDir1, ghostDir2, safeUserDir]);

    expect(purged).toContain(ghostDir1);
    expect(purged).toContain(ghostDir2);
    expect(purged).not.toContain(safeUserDir);

    expect(fs.existsSync(ghostDir1)).toBe(false);
    expect(fs.existsSync(ghostDir2)).toBe(false);
    expect(fs.existsSync(safeUserDir)).toBe(true);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("isGhostPath returns true for ghost directory signatures and false for real user profiles", () => {
    const cleaner = new GhostCleanupService();
    expect(cleaner.isGhostPath("/home/user/.config/convolink/chrome-profile")).toBe(true);
    expect(cleaner.isGhostPath("/tmp/chrome-debug-1234")).toBe(true);
    expect(cleaner.isGhostPath("/tmp/puppeteer_dev_chrome_profile-abc")).toBe(true);
    expect(cleaner.isGhostPath("/home/user/.config/google-chrome")).toBe(false);
    expect(cleaner.isGhostPath("/home/user/.config/microsoft-edge")).toBe(false);
  });
});
