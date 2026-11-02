import { describe, expect, it } from "bun:test";
import { MCP_TOOLS } from "../../src/entrypoints/mcp.schema.js";
import { ensureMcpBrowserReady } from "../../src/entrypoints/mcp.helpers.js";
import { ConfigService } from "../../src/core/services/config.service.js";
import { ProjectConfigAdapter } from "../../src/adapters/config/project-config.adapter.js";
import type { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

describe("MCP Tool Schemas & Human-in-the-Loop Elicitation", () => {
  it("exposes browser and profile parameters in convo_ask and convo_compare schemas", () => {
    const askTool = MCP_TOOLS.find((t) => t.name === "convo_ask");
    expect(askTool).toBeDefined();
    expect(askTool?.inputSchema.properties.browser).toBeDefined();
    expect(askTool?.inputSchema.properties.profile).toBeDefined();

    const compareTool = MCP_TOOLS.find((t) => t.name === "convo_compare");
    expect(compareTool).toBeDefined();
    expect(compareTool?.inputSchema.properties.browser).toBeDefined();
    expect(compareTool?.inputSchema.properties.profile).toBeDefined();

    const doctorTool = MCP_TOOLS.find((t) => t.name === "convo_doctor");
    expect(doctorTool).toBeDefined();
    expect(doctorTool?.inputSchema.properties.browser).toBeDefined();
  });

  it("never auto-binds a profile without the user choosing, even when only one exists", async () => {
    const tmpDir = path.join(os.tmpdir(), `convo-mcp-single-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const mockOrchestrator = {
      doctor: async () => ({
        transportHealth: { ok: false },
      }),
    } as unknown as SessionOrchestrator;

    const singleProfile = [
      {
        browser: "Google Chrome",
        profileId: "Default",
        name: "Solo Developer",
        email: "solo@corp.com",
        userDataDir: "/home/user/.config/google-chrome",
      },
    ];

    const ready = await ensureMcpBrowserReady(mockOrchestrator, {
      workDir: tmpDir,
      discoverProfiles: async () => singleProfile,
      ensureBrowserRunning: async () => true,
    });

    expect(ready.ok).toBe(false);
    expect(ready.requiresUserSelection).toBe(true);

    const config = await new ConfigService(new ProjectConfigAdapter(), tmpDir).loadConfig();
    expect(config).toBeNull();

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns structured HITL elicitation metadata when multiple profiles exist without config", async () => {
    const tmpDir = path.join(os.tmpdir(), `convo-mcp-multi-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const mockOrchestrator = {
      doctor: async () => ({
        transportHealth: { ok: false },
      }),
    } as unknown as SessionOrchestrator;

    const multiProfiles = [
      {
        browser: "Google Chrome",
        profileId: "Default",
        name: "Work Profile",
        email: "work@corp.com",
        userDataDir: "/home/user/.config/google-chrome",
      },
      {
        browser: "Firefox",
        profileId: "release",
        name: "Personal",
        email: "personal@home.com",
        userDataDir: "/home/user/.mozilla/firefox/release",
      },
    ];

    const ready = await ensureMcpBrowserReady(mockOrchestrator, {
      workDir: tmpDir,
      discoverProfiles: async () => multiProfiles,
      ensureBrowserRunning: async () => true,
    });

    expect(ready.ok).toBe(false);
    expect(ready.requiresUserSelection).toBe(true);
    expect(ready.question).toContain("browser profile");
    expect(ready.options?.length).toBe(2);
    expect(ready.options?.[0]).toContain("Work Profile");
    expect(ready.options?.[1]).toContain("Personal");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
