import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { McpServer } from "../../src/entrypoints/mcp.server.js";
import { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { PolicyService } from "../../src/core/services/policy.service.js";
import type { DiscoveredProfile } from "../../src/adapters/browsers/browser-discovery.js";

const CHROME: DiscoveredProfile = {
  browser: "chrome",
  profileId: "Default",
  name: "Personal",
  email: "me@example.com",
  userDataDir: "/home/me/.config/google-chrome",
};

function serverWith(profiles: readonly DiscoveredProfile[], workDir: string): McpServer {
  return new McpServer({
    orchestrator: new SessionOrchestrator({
      browser: new FakeBrowserPort(),
      drivers: [new DeepSeekDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
    }),
    workDir,
    discoverProfiles: async () => [...profiles],
  });
}

async function callSetup(server: McpServer, args: Record<string, unknown>) {
  return await server.handleMessage({
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: { name: "convo_setup", arguments: args },
  });
}

describe("convo_setup without an explicit browser", () => {
  it("returns the profile choice instead of a bare error", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-setup-choice-"));
    try {
      const response = await callSetup(serverWith([CHROME], workDir), {});
      const result = response?.result as unknown as {
        isError?: boolean;
        content: Array<{ text: string }>;
        structuredContent?: { requiresUserSelection?: boolean; options?: string[] };
      };

      expect(result.isError).toBe(true);
      expect(result.structuredContent?.requiresUserSelection).toBe(true);
      expect(result.structuredContent?.options).toEqual(["Personal <me@example.com> (chrome)"]);
      expect(result.content[0]?.text).toContain("convo_profile");
      expect(fs.existsSync(path.join(workDir, ".convo", "config.json"))).toBe(false);
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });

  it("names the explicit setup call when nothing can be discovered", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-setup-empty-"));
    try {
      const response = await callSetup(serverWith([], workDir), {});
      const result = response?.result as unknown as { isError?: boolean; content: Array<{ text: string }> };

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("convo_setup with { browser:");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});

describe("convo_onboard", () => {
  it("reports the same contract the CLI prints", async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "convo-onboard-tool-"));
    try {
      const server = new McpServer({
        orchestrator: new SessionOrchestrator({
          browser: new FakeBrowserPort(),
          drivers: [new DeepSeekDriver()],
          lockService: new LockService(),
          policyGate: new PolicyService(),
        }),
        workDir,
        discoverProfiles: async () => [CHROME],
        collectOnboardFacts: async () => ({
          transport: "extension-bridge",
          port: 9224,
          daemon: { running: false, endpoint: "http://127.0.0.1:9224" },
          extension: { connected: false, clients: 0, buildMismatch: null, unpackedPath: "/ext", pairingToken: "tok" },
          profiles: [CHROME],
          config: null,
          transportHealthy: false,
        }),
      });

      const response = await server.handleMessage({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: "convo_onboard", arguments: {} },
      });
      const result = response?.result as unknown as {
        structuredContent?: { ok: boolean; nextAction?: { kind: string; command?: string; why?: string }; steps: Array<{ id: string; status: string }> };
      };

      expect(result.structuredContent?.ok).toBe(false);
      expect(result.structuredContent?.nextAction).toEqual({ kind: "command", command: "convo daemon start", why: expect.any(String) });
      expect(result.structuredContent?.steps.find((step) => step.id === "profile")?.status).toBe("todo");
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  });
});

describe("convo_setup tool schema", () => {
  it("advertises the no-argument choice call it actually supports", async () => {
    const { MCP_TOOLS } = await import("../../src/entrypoints/mcp.schema.js");
    const setup = MCP_TOOLS.find((tool) => tool.name === "convo_setup");
    const schema = setup?.inputSchema as { required?: string[]; properties?: Record<string, unknown> };

    expect(schema.required ?? []).not.toContain("browser");
    expect(setup?.description).toContain("elicitation");
  });
});
