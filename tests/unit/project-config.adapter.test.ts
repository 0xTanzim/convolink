import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ProjectConfigAdapter } from "../../src/adapters/config/project-config.adapter.js";

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "convo-cfg-"));
}

describe("ProjectConfigAdapter", () => {
  it("reports a missing file without throwing", async () => {
    const dir = tmp();
    const loaded = await new ProjectConfigAdapter().load(dir);
    expect(loaded.status).toBe("missing");
    expect(loaded.config).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes a versioned file with mode 0600 and ignores it in git", async () => {
    const dir = tmp();
    const adapter = new ProjectConfigAdapter();
    const savedPath = await adapter.save({ version: 1, browserId: "firefox", profilePath: "/x" }, dir);

    expect(savedPath).toBe(path.join(dir, ".convo/config.json"));
    const raw = JSON.parse(fs.readFileSync(savedPath, "utf8"));
    expect(raw.version).toBe(1);
    expect(raw.browserId).toBe("firefox");

    const mode = fs.statSync(savedPath).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(fs.readFileSync(path.join(dir, ".convo/.gitignore"), "utf8")).toContain("config.json");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns an invalid result for an unparsable file instead of falling back", async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, ".convo"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".convo/config.json"), "{ not json");

    const loaded = await new ProjectConfigAdapter().load(dir);
    expect(loaded.status).toBe("invalid");
    expect(loaded.problem).toContain("config.json");
    expect(loaded.config).toBeNull();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("treats an unsupported version as invalid", async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, ".convo"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".convo/config.json"), JSON.stringify({ version: 99, browserId: "chrome" }));

    const loaded = await new ProjectConfigAdapter().load(dir);
    expect(loaded.status).toBe("invalid");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads a versionless legacy file as v1 and drops profileEmail on rewrite", async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, ".convo"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".convo/config.json"),
      JSON.stringify({ browser: "firefox", profileEmail: "dev@example.com", profilePath: "/p" }),
    );

    const adapter = new ProjectConfigAdapter();
    const loaded = await adapter.load(dir);
    expect(loaded.status).toBe("ok");
    expect(loaded.config?.browserId).toBe("firefox");
    expect(loaded.config?.profileEmail).toBe("dev@example.com");

    await adapter.update({ defaultPlatform: "deepseek" }, dir);
    const rewritten = JSON.parse(fs.readFileSync(path.join(dir, ".convo/config.json"), "utf8"));
    expect(rewritten.profileEmail).toBeUndefined();
    expect(rewritten.defaultPlatform).toBe("deepseek");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("preserves unknown keys on update", async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, ".convo"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".convo/config.json"),
      JSON.stringify({ version: 1, browserId: "chrome", futureField: { keep: true } }),
    );

    const adapter = new ProjectConfigAdapter();
    await adapter.update({ defaultPlatform: "gemini" }, dir);

    const rewritten = JSON.parse(fs.readFileSync(path.join(dir, ".convo/config.json"), "utf8"));
    expect(rewritten.futureField).toEqual({ keep: true });
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("removes the project file", async () => {
    const dir = tmp();
    const adapter = new ProjectConfigAdapter();
    await adapter.save({ version: 1, browserId: "chrome" }, dir);
    await adapter.remove(dir);
    expect((await adapter.load(dir)).status).toBe("missing");
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
