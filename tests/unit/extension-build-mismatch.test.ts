import { describe, expect, it } from "bun:test";
import { describeBuildMismatch } from "../../src/entrypoints/extension-build.js";

describe("describeBuildMismatch", () => {
  it("names the loaded id and the id on disk", () => {
    const warning = describeBuildMismatch([{ buildId: "dev", profileLabel: "Now" }], "mw09hp0t");
    expect(warning).toContain("dev");
    expect(warning).toContain("mw09hp0t");
    expect(warning).toContain("chrome://extensions");
  });

  it("stays quiet when the loaded bundle matches", () => {
    expect(describeBuildMismatch([{ buildId: "mw09hp0t" }], "mw09hp0t")).toBeNull();
  });

  it("treats a client with no reported id as stale", () => {
    expect(describeBuildMismatch([{}], "mw09hp0t")).toContain("unreported");
  });

  it("does nothing without a built bundle to compare against", () => {
    expect(describeBuildMismatch([{ buildId: "dev" }], null)).toBeNull();
  });
});
