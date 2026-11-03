import { describe, expect, it, spyOn } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runCli } from "../../src/entrypoints/cli.js";
import { resolveCliVersion } from "../../src/entrypoints/cli.version.js";

describe("CLI version reporting", () => {
  it("reports the version declared by the package manifest", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(import.meta.dir, "../../package.json"), "utf-8"),
    ) as { version: string };

    expect(resolveCliVersion()).toBe(pkg.version);
  });

  it("answers --version, -v and version without touching the browser", async () => {
    const chunks: string[] = [];
    const write = spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
      return true;
    }) as typeof process.stdout.write);

    try {
      for (const flag of ["--version", "-v", "version"]) {
        chunks.length = 0;
        expect(await runCli([flag])).toBe(0);
        expect(chunks.join("")).toContain(resolveCliVersion());
      }
    } finally {
      write.mockRestore();
    }
  });
});
