import { describe, expect, it, beforeAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync, spawn } from "node:child_process";

const ROOT_DIR = path.resolve(import.meta.dir, "../..");

describe("Milestone 6: Standalone Dist Bundling & npm Packaging", () => {
  const pkgPath = path.join(ROOT_DIR, "package.json");
  const npmignorePath = path.join(ROOT_DIR, ".npmignore");
  const licensePath = path.join(ROOT_DIR, "LICENSE");
  const buildScriptPath = path.join(ROOT_DIR, "scripts/build-dist.ts");
  const distDir = path.join(ROOT_DIR, "dist");
  const distCliPath = path.join(distDir, "cli.js");
  const distMcpPath = path.join(distDir, "mcp.js");

  describe("package.json packaging configuration", () => {
    it("declares proper bin, main, files, engines, and publishConfig", () => {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));

      expect(pkg.main).toBe("./dist/cli.js");
      expect(pkg.mcpName).toBe("convolink");

      expect(pkg.bin).toBeDefined();
      expect(pkg.bin.convolink).toMatch(/^(?:\.\/)?dist\/cli\.js$/);
      expect(pkg.bin.convo).toMatch(/^(?:\.\/)?dist\/cli\.js$/);
      expect(pkg.bin["convolink-mcp"]).toMatch(/^(?:\.\/)?dist\/mcp\.js$/);

      expect(pkg.files).toEqual(expect.arrayContaining(["dist", "README.md", "LICENSE"]));

      expect(pkg.engines).toBeDefined();
      expect(pkg.engines.bun).toBe(">=1.2.0");

      expect(pkg.publishConfig).toBeDefined();
      expect(pkg.publishConfig.access).toBe("public");
      expect(pkg.publishConfig.registry).toBe("https://registry.npmjs.org/");

      expect(pkg.scripts).toBeDefined();
      expect(pkg.scripts["build:dist"]).toBe("bun run scripts/build-dist.ts");
      expect(pkg.scripts.prepublishOnly).toBe("bun run build:dist");
    });
  });

  describe(".npmignore rules", () => {
    it("exists and excludes non-dist development workspaces and metadata", () => {
      expect(fs.existsSync(npmignorePath)).toBe(true);
      const content = fs.readFileSync(npmignorePath, "utf-8");

      const requiredExclusions = [
        "website/",
        "extensions/",
        "tests/",
        "scripts/",
        ".agents/",
        ".github/",
        "docs/",
        "bin/",
        "*.log",
        ".convo/",
      ];

      for (const exclusion of requiredExclusions) {
        expect(content).toContain(exclusion);
      }
    });
  });

  describe("LICENSE file", () => {
    it("exists and contains standard MIT license text", () => {
      expect(fs.existsSync(licensePath)).toBe(true);
      const content = fs.readFileSync(licensePath, "utf-8");
      expect(content).toContain("MIT License");
      expect(content).toContain("Permission is hereby granted, free of charge");
    });
  });

  describe("scripts/build-dist.ts build execution", () => {
    it("exists as a build script", () => {
      expect(fs.existsSync(buildScriptPath)).toBe(true);
    });

    it("builds dist/cli.js and dist/mcp.js with shebang and 0o755 mode", async () => {
      const { buildDist } = await import("../../scripts/build-dist.js");
      const result = await buildDist();

      expect(result.success).toBe(true);
      expect(fs.existsSync(distCliPath)).toBe(true);
      expect(fs.existsSync(distMcpPath)).toBe(true);

      const cliContent = fs.readFileSync(distCliPath, "utf-8");
      const cliLines = cliContent.split("\n");
      expect(cliLines[0]).toBe("#!/usr/bin/env bun");

      const mcpContent = fs.readFileSync(distMcpPath, "utf-8");
      const mcpLines = mcpContent.split("\n");
      expect(mcpLines[0]).toBe("#!/usr/bin/env bun");

      const cliStat = fs.statSync(distCliPath);
      const mcpStat = fs.statSync(distMcpPath);

      expect(cliStat.mode & 0o777).toBe(0o755);
      expect(mcpStat.mode & 0o777).toBe(0o755);
    });
  });

  describe("Standalone dist binary execution", () => {
    it("executes dist/cli.js --help cleanly without hanging on stdin", () => {
      const proc = spawnSync(distCliPath, ["--help"], {
        encoding: "utf-8",
        timeout: 5000,
      });

      expect(proc.status).toBe(0);
      expect(proc.stdout).toContain("ConvoLink");
      expect(proc.stdout).toContain("Usage:");
    });

    it("executes dist/mcp.js tools/list and returns the focused cognitive tools", async () => {
      const res = await new Promise<string>((resolve, reject) => {
        const proc = spawn(distMcpPath, [], {
          stdio: ["pipe", "pipe", "pipe"],
        });

        let stdout = "";
        proc.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
        });

        const timer = setTimeout(() => {
          proc.kill("SIGKILL");
          reject(new Error("Timeout waiting for MCP response"));
        }, 5000);

        proc.on("close", () => {
          clearTimeout(timer);
          resolve(stdout);
        });

        const msg = JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        });
        proc.stdin.write(msg + "\n");
        proc.stdin.end();
      });

      const parsed = JSON.parse(res.trim());
      expect(parsed.jsonrpc).toBe("2.0");
      expect(parsed.id).toBe(1);
      expect(parsed.result).toBeDefined();
      expect(parsed.result.tools).toBeInstanceOf(Array);
      expect(parsed.result.tools.length).toBe(8);

      const toolNames = parsed.result.tools.map((t: { name: string }) => t.name);
      expect(toolNames).toContain("convo_ask");
      expect(toolNames).toContain("convo_compare");
      expect(toolNames).toContain("convo_doctor");
      expect(toolNames).toContain("convo_list_tabs");
      expect(toolNames).toContain("convo_tab");
      expect(toolNames).toContain("convo_search");
      expect(toolNames).toContain("convo_thread");
      expect(toolNames).toContain("convo_profile");
    });
  });
});
