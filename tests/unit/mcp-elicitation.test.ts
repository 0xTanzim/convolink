import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createElicitationBridge } from "../../src/entrypoints/mcp.elicitation.js";
import { McpServer } from "../../src/entrypoints/mcp.server.js";
import { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { PolicyService } from "../../src/core/services/policy.service.js";
import type { DiscoveredProfile } from "../../src/adapters/browsers/browser-discovery.js";
import type { ApplySetupFn } from "../../src/entrypoints/mcp.tools.js";

const PROFILE: DiscoveredProfile = {
  browser: "chrome",
  profileId: "Default",
  name: "Personal",
  email: "me@example.com",
  userDataDir: "/home/me/.config/google-chrome",
};

const SCHEMA = {
  type: "object" as const,
  properties: { profile: { type: "string" as const, enum: ["A", "B"] } },
  required: ["profile"],
};

describe("Elicitation bridge", () => {
  it("writes a request and resolves with the client's answer", async () => {
    const written: Array<Record<string, unknown>> = [];
    const bridge = createElicitationBridge({ write: (message) => written.push(message as Record<string, unknown>), timeoutMs: 50 });
    bridge.setSupported(true);

    const promise = bridge.port.request({ message: "Pick one", requestedSchema: SCHEMA });
    expect(written).toHaveLength(1);
    expect(written[0]?.method).toBe("elicitation/create");
    expect(bridge.pendingCount()).toBe(1);

    const id = written[0]?.id as string;
    expect(bridge.handleResponse({ id, result: { action: "accept", content: { profile: "B" } } })).toBe(true);
    expect(await promise).toEqual({ action: "accept", content: { profile: "B" } });
    expect(bridge.pendingCount()).toBe(0);
  });

  it("degrades to cancel when the client never answers", async () => {
    const bridge = createElicitationBridge({ write: () => {}, timeoutMs: 20 });
    bridge.setSupported(true);

    const started = Date.now();
    const response = await bridge.port.request({ message: "Pick one", requestedSchema: SCHEMA });

    expect(response.action).toBe("cancel");
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
    expect(bridge.pendingCount()).toBe(0);
  });

  it("ignores replies it did not ask for", () => {
    const bridge = createElicitationBridge({ write: () => {}, timeoutMs: 20 });
    expect(bridge.handleResponse({ id: "unknown", result: { action: "accept" } })).toBe(false);
  });
});

function makeServer(workDir: string, outbound: Array<Record<string, unknown>>) {
  return new McpServer({
    orchestrator: new SessionOrchestrator({
      browser: new FakeBrowserPort(),
      drivers: [new DeepSeekDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
    }),
    workDir,
    notify: (message) => outbound.push(message as Record<string, unknown>),
    discoverProfiles: async () => [PROFILE],
    elicitationTimeoutMs: 2_000,
  });
}

const initialize = (capability: boolean) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: capability ? { elicitation: {} } : {}, clientInfo: { name: "t", version: "1" } },
});

describe("convo_setup elicitation", () => {
  it("asks the client and applies the chosen profile when the capability is advertised", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-elicit-"));
    const outbound: Array<Record<string, unknown>> = [];
    const applied: Array<Record<string, unknown>> = [];
    const fakeApply = (async (input: Record<string, unknown>) => {
      applied.push(input);
      return {
        config: { version: 1, browserId: "chrome", profilePath: PROFILE.userDataDir, transport: "extension-bridge", port: 9224 },
      };
    }) as unknown as ApplySetupFn;
    const server = new McpServer({
      orchestrator: new SessionOrchestrator({
        browser: new FakeBrowserPort(),
        drivers: [new DeepSeekDriver()],
        lockService: new LockService(),
        policyGate: new PolicyService(),
      }),
      workDir,
      notify: (message) => outbound.push(message as Record<string, unknown>),
      discoverProfiles: async () => [PROFILE],
      applySetupFn: fakeApply,
      elicitationTimeoutMs: 2_000,
    });

    try {
      await server.handleMessage(initialize(true) as never);

      const pending = server.handleMessage({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "convo_setup", arguments: {} },
      });

      const request = await waitFor(() => outbound.find((message: Record<string, unknown>) => message.method === "elicitation/create"));
      const params = request.params as { message: string; requestedSchema: { properties: { profile: { enum: string[] } } } };
      expect(params.message).toContain("profile");
      expect(params.requestedSchema.properties.profile.enum).toEqual(["Personal <me@example.com> (chrome)"]);

      await server.handleMessage({
        jsonrpc: "2.0",
        id: request.id,
        result: { action: "accept", content: { profile: "Personal <me@example.com> (chrome)" } },
      } as never);

      const response = await pending;
      const result = response?.result as unknown as { isError?: boolean; structuredContent?: { ok?: boolean; answeredBy?: string } };

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent?.ok).toBe(true);
      expect(result.structuredContent?.answeredBy).toBe("elicitation");
      expect(applied[0]?.browserId).toBe("chrome");
      expect(applied[0]?.profilePath).toBe(PROFILE.userDataDir);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("falls back to the text block when the client has no elicitation capability", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-elicit-off-"));
    const outbound: Array<Record<string, unknown>> = [];
    const server = makeServer(workDir, outbound);

    try {
      await server.handleMessage(initialize(false) as never);
      const response = await server.handleMessage({
        jsonrpc: "2.0",
        id: 9,
        method: "tools/call",
        params: { name: "convo_setup", arguments: {} },
      });

      const result = response?.result as unknown as { isError?: boolean; structuredContent?: { requiresUserSelection?: boolean } };
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.requiresUserSelection).toBe(true);
      expect(outbound.some((message) => message.method === "elicitation/create")).toBe(false);
      expect(fs.existsSync(path.join(workDir, ".convo", "config.json"))).toBe(false);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});

async function waitFor<T>(find: () => T | undefined, timeoutMs = 1_000): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = find();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("timed out waiting for outbound message");
}
