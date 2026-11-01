import { describe, expect, it } from "bun:test";
import { parseTargetVersion, formatReleaseNotes } from "../../scripts/release.js";

describe("Release Management Tooling (scripts/release.ts)", () => {
  it("resolves target versions correctly for bump keywords", () => {
    expect(parseTargetVersion("patch", "1.0.0")).toBe("1.0.1");
    expect(parseTargetVersion("minor", "1.0.0")).toBe("1.1.0");
    expect(parseTargetVersion("major", "1.0.0")).toBe("2.0.0");
    expect(parseTargetVersion("v1.2.3", "1.0.0")).toBe("1.2.3");
    expect(parseTargetVersion("1.0.0", "1.0.0")).toBe("1.0.0");
  });

  it("formats structured release notes with artifact lists", () => {
    const notes = formatReleaseNotes("1.0.0");
    expect(notes).toContain("ConvoLink Companion v1.0.0");
    expect(notes).toContain("convolink-companion-chrome.zip");
    expect(notes).toContain("convolink-companion-firefox.zip");
    expect(notes).toContain("Zero-Flag Extension Bridge");
  });
});
