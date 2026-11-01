import { describe, expect, it } from "bun:test";
import { handleProfile } from "../../src/entrypoints/cli.ops.js";
import { ConfigService } from "../../src/core/services/config.service.js";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

describe("CLI Profile Operations (convo profile)", () => {
  const tmpDir = path.join(os.tmpdir(), `convo-cli-profile-${Date.now()}`);

  it("handles profile list command without crashing", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (...args: unknown[]) => { output += args.join(" ") + "\n"; };

    try {
      const code = await handleProfile(["list"]);
      expect(code).toBe(0);
      expect(output).toContain("Discovered Browser Profiles");
    } finally {
      console.log = origLog;
    }
  });

  it("selects and persists preferred profile into .convo/config.json", async () => {
    const configService = new ConfigService(tmpDir);
    await configService.saveConfig({ profileId: "dev-profile", profileEmail: "developer@example.com" });

    const loaded = await configService.loadConfig(tmpDir);
    expect(loaded?.profileId).toBe("dev-profile");
    expect(loaded?.profileEmail).toBe("developer@example.com");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
