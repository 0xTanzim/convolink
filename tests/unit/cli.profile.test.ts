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

  it("handles profile list --json and outputs structured JSON for agents", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (...args: unknown[]) => { output += args.join(" ") + "\n"; };

    try {
      const code = await handleProfile(["list", "--json"]);
      expect(code).toBe(0);
      const parsed = JSON.parse(output.trim());
      expect(Array.isArray(parsed)).toBe(true);
      if (parsed.length > 0) {
        expect(parsed[0].index).toBe(1);
        expect(parsed[0].browser).toBeDefined();
        expect(parsed[0].name).toBeDefined();
      }
    } finally {
      console.log = origLog;
    }
  });

  it("returns error with helpful shell comment tip when select target is omitted in non-interactive mode", async () => {
    let errOutput = "";
    const origErr = console.error;
    console.error = (...args: unknown[]) => { errOutput += args.join(" ") + "\n"; };

    try {
      const code = await handleProfile(["select"]);
      expect(code).toBe(1);
      expect(errOutput).toContain("Please provide profile number");
      expect(errOutput).toContain("quote '#1'");
    } finally {
      console.error = origErr;
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
