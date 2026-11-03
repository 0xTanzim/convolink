import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { handleSkill, SKILL_TARGETS } from "../../src/entrypoints/cli.skill.js";

async function run(args: string[]): Promise<number> {
  const log = console.log;
  const error = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    return await handleSkill(args);
  } finally {
    console.log = log;
    console.error = error;
  }
}

describe("convo skill install", () => {
  it("writes the skill where OpenCode reads it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-skill-"));
    try {
      expect(await run(["install", "--harness", "opencode", "--dir", dir])).toBe(0);
      const file = path.join(dir, SKILL_TARGETS.opencode);
      expect(fs.existsSync(file)).toBe(true);
      const text = fs.readFileSync(file, "utf-8");
      expect(text).toContain("name: convolink");
      expect(text).toContain("convo onboard");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses to clobber an edited skill unless forced", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-skill-"));
    try {
      const file = path.join(dir, SKILL_TARGETS.claude);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "hand edited");

      expect(await run(["install", "--harness", "claude", "--dir", dir])).toBe(4);
      expect(fs.readFileSync(file, "utf-8")).toBe("hand edited");

      expect(await run(["install", "--harness", "claude", "--dir", dir, "--force"])).toBe(0);
      expect(fs.readFileSync(file, "utf-8")).toContain("name: convolink");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects an unknown harness with a configuration error", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-skill-"));
    try {
      expect(await run(["install", "--harness", "notepad", "--dir", dir])).toBe(2);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("lists the harnesses it knows", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-skill-"));
    try {
      expect(await run(["list", "--dir", dir])).toBe(0);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
