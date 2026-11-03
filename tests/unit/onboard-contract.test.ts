import { describe, expect, it } from "bun:test";
import { buildOnboardReport, type OnboardFacts } from "../../src/core/services/onboarding.service.js";

const PROFILE = { browser: "chrome", profileId: "Default", name: "Personal", email: "me@example.com", userDataDir: "/home/me/.config/google-chrome" };

function facts(overrides: Partial<OnboardFacts> = {}): OnboardFacts {
  return {
    transport: "extension-bridge",
    port: 9224,
    daemon: { running: true, endpoint: "http://127.0.0.1:9224" },
    extension: { connected: true, clients: 1, buildMismatch: null, unpackedPath: "/repo/ext/.output/chrome-mv3", pairingToken: "token-abc" },
    profiles: [PROFILE],
    config: { browser: "chrome", profilePath: "/home/me/.config/google-chrome", transport: "extension-bridge", port: 9224 },
    transportHealthy: true,
    ...overrides,
  };
}

describe("Onboarding contract", () => {
  it("is ready when daemon, extension, profile and transport all answer", () => {
    const report = buildOnboardReport(facts());

    expect(report.ok).toBe(true);
    expect(report.nextAction).toBeNull();
    expect(report.steps.every((step) => step.status === "done")).toBe(true);
    expect(report.requiresUserSelection).toBeNull();
  });

  it("tells the agent to start the daemon before anything else", () => {
    const report = buildOnboardReport(facts({ daemon: { running: false, endpoint: "http://127.0.0.1:9224" }, extension: { connected: false, clients: 0, buildMismatch: null, unpackedPath: "/ext", pairingToken: "t" } }));

    expect(report.ok).toBe(false);
    expect(report.nextAction).toEqual({ kind: "command", command: "convo daemon start", why: expect.stringContaining("daemon") });
    expect(report.steps.find((s) => s.id === "daemon")?.status).toBe("todo");
  });

  it("hands the pairing token to the human only after the daemon is up", () => {
    const report = buildOnboardReport(
      facts({ extension: { connected: false, clients: 0, buildMismatch: null, unpackedPath: "/repo/ext/.output/chrome-mv3", pairingToken: "token-abc" } }),
    );

    expect(report.ok).toBe(false);
    expect(report.nextAction?.kind).toBe("user");
    expect(report.nextAction?.instruction).toContain("token-abc");
    expect(report.nextAction?.instruction).toContain("/repo/ext/.output/chrome-mv3");
    expect(report.steps.find((s) => s.id === "extension")?.status).toBe("todo");
  });

  it("returns a profile choice instead of writing a config for the user", () => {
    const report = buildOnboardReport(facts({ config: null }));

    expect(report.ok).toBe(false);
    expect(report.requiresUserSelection?.question).toContain("profile");
    expect(report.requiresUserSelection?.options).toEqual(["Personal <me@example.com> (chrome)"]);
    expect(report.nextAction?.kind).toBe("user");
  });

  it("reports an unhealthy transport with the command that diagnoses it", () => {
    const report = buildOnboardReport(facts({ transportHealthy: false }));

    expect(report.ok).toBe(false);
    expect(report.steps.find((s) => s.id === "transport")?.status).toBe("blocked");
    expect(report.nextAction).toEqual({ kind: "command", command: "convo doctor", why: expect.any(String) });
  });

  it("surfaces a stale extension bundle without blocking the rest of the flow", () => {
    const report = buildOnboardReport(
      facts({ extension: { connected: true, clients: 1, buildMismatch: "running mw0bcpqe, built mw0con1f", unpackedPath: "/ext", pairingToken: "t" } }),
    );

    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual(["running mw0bcpqe, built mw0con1f"]);
  });
});

describe("Onboarding instructions on a machine without the repository", () => {
  it("points at the release archive when no unpacked extension is bundled", () => {
    const report = buildOnboardReport(
      facts({
        extension: { connected: false, clients: 0, buildMismatch: null, unpackedPath: null, pairingToken: "token-abc" },
      }),
    );

    const instruction = report.nextAction?.instruction ?? "";
    expect(instruction).toContain("token-abc");
    expect(instruction).toContain("releases/latest");
    expect(instruction).not.toContain("Folder:");
  });
});
