import { describe, expect, it } from "bun:test";
import { runCli } from "../../src/entrypoints/cli.js";

describe("CLI Entrypoint", () => {
  it("prints help and returns code 0 when --help is passed", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      const code = await runCli(["--help"]);
      expect(code).toBe(0);
      expect(output).toContain("ConvoLink CLI");
      expect(output).toContain("convo doctor");
      expect(output).toContain("convo ask");
    } finally {
      console.log = origLog;
    }
  });

  it("returns error code 1 when ask is called with empty prompt", async () => {
    let errOutput = "";
    const origErr = console.error;
    console.error = (...args: unknown[]) => {
      errOutput += args.join(" ") + "\n";
    };

    try {
      const code = await runCli(["ask"]);
      expect(code).toBe(1);
      expect(errOutput).toContain("Prompt is required");
    } finally {
      console.error = origErr;
    }
  });
});
