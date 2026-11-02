import { describe, expect, it } from "bun:test";
import { resolveSetup } from "../../src/core/services/setup/precedence.js";
import type { ConvoProjectConfig } from "../../src/core/ports/config.port.js";

const project: ConvoProjectConfig = { version: 1, browserId: "firefox", profilePath: "/ff", transport: "firefox-bidi" };
const user: ConvoProjectConfig = { version: 1, browserId: "chrome", profilePath: "/chrome" };

describe("resolveSetup precedence", () => {
  it("prefers explicit flags over everything", () => {
    const result = resolveSetup({ overrides: { browserId: "zen" }, project, user });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.browserId).toBe("zen");
    expect(result.value.sources.browserId).toBe("flag");
  });

  it("prefers environment over project configuration", () => {
    const result = resolveSetup({ overrides: {}, project, user, env: { CONVOLINK_PROFILE: "/env-profile" } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.profilePath).toBe("/env-profile");
    expect(result.value.sources.profilePath).toBe("env");
  });

  it("prefers project configuration over user configuration", () => {
    const result = resolveSetup({ overrides: {}, project, user });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.browserId).toBe("firefox");
    expect(result.value.profilePath).toBe("/ff");
    expect(result.value.sources.browserId).toBe("project");
  });

  it("falls back to the user configuration", () => {
    const result = resolveSetup({ overrides: {}, project: null, user });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.browserId).toBe("chrome");
    expect(result.value.sources.browserId).toBe("user");
  });

  it("fails with configuration-required instead of inventing a browser", () => {
    const result = resolveSetup({ overrides: {}, project: null, user: null });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("configuration-required");
    expect(result.error.remediation).toContain("convo setup");
  });

  it("derives the Gecko transport from the browser when transport is absent", () => {
    const result = resolveSetup({ overrides: {}, project: { version: 1, browserId: "zen" }, user: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transport).toBe("firefox-bidi");
    expect(result.value.port).toBe(9223);
  });

  it("derives the Chromium transport and port when transport is absent", () => {
    const result = resolveSetup({ overrides: {}, project: { version: 1, browserId: "brave" }, user: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.transport).toBe("raw-cdp");
    expect(result.value.port).toBe(9222);
  });

  it("reports a transport/browser mismatch instead of connecting", () => {
    const result = resolveSetup({
      overrides: { transport: "raw-cdp" },
      project,
      user: null,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("transport-mismatch");
  });

  it("keeps an explicitly configured port", () => {
    const result = resolveSetup({ overrides: {}, project: { version: 1, browserId: "chrome", port: 9555 }, user: null });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.port).toBe(9555);
  });
});
