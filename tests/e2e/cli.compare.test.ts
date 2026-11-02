import { describe, expect, it } from "bun:test";
import { runCli } from "../../src/entrypoints/cli.js";

describe("CLI Compare Command", () => {
  it("prints help containing convo compare", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      const code = await runCli(["--help"]);
      expect(code).toBe(0);
      expect(output).toContain("convo compare");
      expect(output).toContain("--arbitrate");
      expect(output).toContain("--arbiter <platform>");
    } finally {
      console.log = origLog;
    }
  });

  it("fails with the internal exit code if prompt is omitted", async () => {
    let errOutput = "";
    const origErr = console.error;
    console.error = (...args: unknown[]) => {
      errOutput += args.join(" ") + "\n";
    };

    try {
      const code = await runCli(["compare"]);
      expect(code).toBe(6);
      expect(errOutput).toContain("Prompt is required for comparison");
    } finally {
      console.error = origErr;
    }
  });
});
