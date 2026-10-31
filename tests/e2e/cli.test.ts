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

  it("prints help containing tab, undo, history, and transport options", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      const code = await runCli(["--help"]);
      expect(code).toBe(0);
      expect(output).toContain("convo tab new");
      expect(output).toContain("convo undo");
      expect(output).toContain("convo history");
      expect(output).toContain("--transport");
      expect(output).toContain("--new, -n");
      expect(output).toContain("--open-tab");
    } finally {
      console.log = origLog;
    }
  });

  it("handles history command cleanly", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      const code = await runCli(["history"]);
      expect(code).toBe(0);
      expect(output).toContain("Recent Checkpoints");
    } finally {
      console.log = origLog;
    }
  });

  it("handles undo when no checkpoint is present cleanly", async () => {
    let output = "";
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      output += args.join(" ") + "\n";
    };

    try {
      const code = await runCli(["undo"]);
      expect(code).toBe(0);
      expect(output).toContain("No previous checkpoint found");
    } finally {
      console.log = origLog;
    }
  });
});
