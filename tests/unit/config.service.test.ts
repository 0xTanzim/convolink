import { describe, expect, it } from "bun:test";
import { ConfigService, mergeConfig, type ConvoProjectConfig } from "../../src/core/services/config.service.js";
import { ProjectConfigAdapter } from "../../src/adapters/config/project-config.adapter.js";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

function service(): ConfigService {
  return new ConfigService(new ProjectConfigAdapter());
}

describe("ConfigService (.convo/config.json)", () => {
  const tmpDir = path.join(os.tmpdir(), `convo-config-test-${Date.now()}`);

  it("loads null when .convo/config.json does not exist", async () => {
    const config = await service().loadConfig(tmpDir);
    expect(config).toBeNull();
  });

  it("saves and loads project configuration in .convo/config.json", async () => {
    const testConfig: ConvoProjectConfig = {
      version: 1,
      profileId: "dev-profile",
      profilePath: "/path/to/profile",
      defaultPlatform: "chatgpt",
      transport: "raw-cdp",
      browserId: "chrome",
    };

    const savedPath = await service().saveConfig(testConfig, tmpDir);
    expect(fs.existsSync(savedPath)).toBe(true);
    expect(savedPath).toBe(path.join(tmpDir, ".convo/config.json"));

    const loaded = await service().loadConfig(tmpDir);
    expect(loaded?.profileId).toBe("dev-profile");
    expect(loaded?.defaultPlatform).toBe("chatgpt");
    expect(loaded?.browserId).toBe("chrome");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("merges partial updates without overwriting existing fields", async () => {
    await service().saveConfig({ version: 1, profileId: "default" }, tmpDir);
    await service().updateConfig({ defaultPlatform: "deepseek" }, tmpDir);

    const updated = await service().loadConfig(tmpDir);
    expect(updated?.profileId).toBe("default");
    expect(updated?.defaultPlatform).toBe("deepseek");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("never erases a field when a partial update carries undefined", () => {
    const merged = mergeConfig({ version: 1, browserId: "firefox", port: 9223 }, { port: undefined });
    expect(merged.browserId).toBe("firefox");
    expect(merged.port).toBe(9223);
  });
});
