import { describe, expect, it } from "bun:test";
import { ConfigService, type ConvoProjectConfig } from "../../src/core/services/config.service.js";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

describe("ConfigService (.convo/config.json)", () => {
  const tmpDir = path.join(os.tmpdir(), `convo-config-test-${Date.now()}`);

  it("loads null when .convo/config.json does not exist", async () => {
    const configService = new ConfigService();
    const config = await configService.loadConfig(tmpDir);
    expect(config).toBeNull();
  });

  it("saves and loads project configuration in .convo/config.json", async () => {
    const configService = new ConfigService();
    const testConfig: ConvoProjectConfig = {
      profileId: "dev-profile",
      profileEmail: "developer@example.com",
      profilePath: "/path/to/profile",
      preferredPlatform: "chatgpt",
      transport: "raw-cdp",
    };

    const savedPath = await configService.saveConfig(testConfig, tmpDir);
    expect(fs.existsSync(savedPath)).toBe(true);
    expect(savedPath).toBe(path.join(tmpDir, ".convo/config.json"));

    const loaded = await configService.loadConfig(tmpDir);
    expect(loaded).toBeDefined();
    expect(loaded?.profileId).toBe("dev-profile");
    expect(loaded?.profileEmail).toBe("developer@example.com");
    expect(loaded?.preferredPlatform).toBe("chatgpt");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merges partial updates without overwriting existing fields", async () => {
    const configService = new ConfigService();
    await configService.saveConfig({ profileId: "default", profileEmail: "user@corp.com" }, tmpDir);

    await configService.updateConfig({ preferredPlatform: "deepseek" }, tmpDir);

    const updated = await configService.loadConfig(tmpDir);
    expect(updated?.profileId).toBe("default");
    expect(updated?.profileEmail).toBe("user@corp.com");
    expect(updated?.preferredPlatform).toBe("deepseek");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
