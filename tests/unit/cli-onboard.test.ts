import { describe, expect, it, spyOn } from "bun:test";
import { handleOnboard } from "../../src/entrypoints/cli.onboard.js";
import { buildOnboardReport, type OnboardFacts } from "../../src/core/services/onboarding.service.js";

const PROFILE = { browser: "chrome", profileId: "Default", name: "Personal", email: "me@example.com", userDataDir: "/home/me/.config/google-chrome" };

function facts(overrides: Partial<OnboardFacts> = {}): OnboardFacts {
  return {
    transport: "extension-bridge",
    port: 9224,
    daemon: { running: true, endpoint: "http://127.0.0.1:9224" },
    extension: { connected: true, clients: 1, buildMismatch: null, unpackedPath: "/ext/.output/chrome-mv3", pairingToken: "token-abc" },
    profiles: [PROFILE],
    config: { browser: "chrome", profilePath: "/profile", transport: "extension-bridge", port: 9224 },
    transportHealthy: true,
    ...overrides,
  };
}

async function run(args: string[], collected: OnboardFacts): Promise<{ code: number; out: string }> {
  const chunks: string[] = [];
  const write = spyOn(process.stdout, "write").mockImplementation(((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString());
    return true;
  }) as typeof process.stdout.write);
  const log = spyOn(console, "log").mockImplementation(((...values: unknown[]) => {
    chunks.push(values.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" ") + "\n");
  }) as typeof console.log);

  try {
    const code = await handleOnboard(args, { collectFacts: async () => collected });
    return { code, out: chunks.join("") };
  } finally {
    write.mockRestore();
    log.mockRestore();
  }
}

describe("convo onboard", () => {
  it("exits 0 with a machine-readable report when the project is ready", async () => {
    const { code, out } = await run(["--json"], facts());
    const payload = JSON.parse(out) as { ok: boolean; data: { nextAction: unknown } };

    expect(code).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.data.nextAction).toBeNull();
  });

  it("exits 4 when the next step needs a human in the browser", async () => {
    const { code, out } = await run(["--json"], facts({
      extension: { connected: false, clients: 0, buildMismatch: null, unpackedPath: "/ext/.output/chrome-mv3", pairingToken: "token-abc" },
    }));
    const payload = JSON.parse(out) as { ok: boolean; data: { nextAction: { kind: string; instruction: string } } };

    expect(code).toBe(4);
    expect(payload.ok).toBe(false);
    expect(payload.data.nextAction.kind).toBe("user");
    expect(payload.data.nextAction.instruction).toContain("token-abc");
  });

  it("exits 3 when the transport itself is down", async () => {
    const { code } = await run(["--json"], facts({ daemon: { running: false, endpoint: "http://127.0.0.1:9224" }, transportHealthy: false }));
    expect(code).toBe(3);
  });

  it("prints the next action in the human output", async () => {
    const { code, out } = await run([], facts({ config: null }));

    expect(code).toBe(4);
    expect(out).toContain("Personal <me@example.com> (chrome)");
    expect(out).toContain("convo profile select");
  });

  it("uses the same report the contract builds", async () => {
    const collected = facts({ transportHealthy: false });
    const { out } = await run(["--json"], collected);
    const payload = JSON.parse(out) as { data: unknown };

    expect(payload.data).toEqual(buildOnboardReport(collected) as unknown as Record<string, unknown>);
  });
});
