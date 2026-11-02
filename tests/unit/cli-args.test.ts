import { describe, expect, it } from "bun:test";
import { parseAskArgs, parseCompareArgs } from "../../src/entrypoints/cli.args.js";

describe("CLI Argument Parser (parseAskArgs & parseCompareArgs)", () => {
  it("parses -p and --platform aliases identically", () => {
    const resShort = parseAskArgs(["-p", "deepseek", "hello"]);
    expect(resShort.platform).toBe("deepseek");
    expect(resShort.prompt).toBe("hello");

    const resLong = parseAskArgs(["--platform", "claude", "hello world"]);
    expect(resLong.platform).toBe("claude");
    expect(resLong.prompt).toBe("hello world");
  });

  it("parses -t, --target, and --targetId aliases identically", () => {
    const resT = parseAskArgs(["-t", "tab-101", "my prompt"]);
    expect(resT.targetId).toBe("tab-101");
    expect(resT.prompt).toBe("my prompt");

    const resTarget = parseAskArgs(["--target", "tab-102", "my prompt"]);
    expect(resTarget.targetId).toBe("tab-102");

    const resTargetId = parseAskArgs(["--targetId", "tab-103", "my prompt"]);
    expect(resTargetId.targetId).toBe("tab-103");
  });

  it("parses -o and --out-dir aliases in ask and compare", () => {
    const askRes = parseAskArgs(["-o", "./custom-artifacts", "run"]);
    expect(askRes.outDir).toBe("./custom-artifacts");

    const askCamel = parseAskArgs(["--outDir", "./custom-artifacts", "run"]);
    expect(askCamel.outDir).toBe("./custom-artifacts");

    const compareRes = parseCompareArgs(["-o", "./cmp-artifacts", "compare models"]);
    expect(compareRes.outDir).toBe("./cmp-artifacts");

    const compareLong = parseCompareArgs(["--out-dir", "./cmp-long", "compare models"]);
    expect(compareLong.outDir).toBe("./cmp-long");

    const compareCamel = parseCompareArgs(["--outDir", "./cmp-camel", "compare models"]);
    expect(compareCamel.outDir).toBe("./cmp-camel");
  });

  it("parses boolean flags without treating them as prompt words", () => {
    const res = parseAskArgs([
      "-w", "-n", "--think", "--search", "-p", "deepseek", "-t", "tab-99", "-o", "./out", "Write quicksort"
    ]);
    expect(res.writeFiles).toBe(true);
    expect(res.newChat).toBe(true);
    expect(res.toggles.think).toBe(true);
    expect(res.toggles.search).toBe(true);
    expect(res.platform).toBe("deepseek");
    expect(res.targetId).toBe("tab-99");
    expect(res.outDir).toBe("./out");
    expect(res.prompt).toBe("Write quicksort");
  });

  it("defaults launch to false and only enables it when --launch is explicitly provided", () => {
    const defaultAsk = parseAskArgs(["-p", "deepseek", "hello"]);
    expect(defaultAsk.launch).toBe(false);

    const launchedAsk = parseAskArgs(["--launch", "-p", "deepseek", "hello"]);
    expect(launchedAsk.launch).toBe(true);

    const defaultCmp = parseCompareArgs(["-p", "deepseek,claude", "test"]);
    expect(defaultCmp.launch).toBe(false);

    const launchedCmp = parseCompareArgs(["--launch", "-p", "deepseek,claude", "test"]);
    expect(launchedCmp.launch).toBe(true);
  });
});
