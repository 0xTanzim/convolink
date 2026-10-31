import { describe, expect, it } from "bun:test";
import { runCli } from "../../src/entrypoints/cli.js";

describe("CLI Artifact Flags", () => {
  it("displays artifact and continuation options in help output", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      const code = await runCli(["--help"]);
      expect(code).toBe(0);
      expect(output).toContain("--write-files");
      expect(output).toContain("--out-dir");
      expect(output).toContain("--no-continue");
    } finally {
      console.log = origLog;
    }
  });
});
