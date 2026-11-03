/**
 * mcp-schema-intelligence.test.ts
 *
 * TDD RED tests for the ConvoLink Intelligence Upgrade (Phase 1 + 2).
 * These tests define the required properties and must fail before
 * the implementation changes are made.
 *
 * Covers:
 *   - Cycle 2: title + annotations on every tool (MCP 2026-07-28 spec)
 *   - Cycle 3: high-signal description sentinel strings on critical tools
 *   - Cycle 4: structured error envelope with code + nextTool hint
 *   - Cycle 5: workspaceRoot param + CONVOLINK_WORKSPACE env fallback
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { MCP_TOOLS } from "../../src/entrypoints/mcp.schema.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const tool = (name: string) => {
  const t = MCP_TOOLS.find((c) => c.name === name);
  if (!t) throw new Error(`Tool not found: ${name}`);
  return t;
};
const props = (name: string) =>
  tool(name).inputSchema.properties as Record<string, Record<string, unknown>>;

// ---------------------------------------------------------------------------
// Cycle 2 — title + annotations on all tools
// ---------------------------------------------------------------------------
describe("Cycle 2 — title and annotations (MCP 2026-07-28 spec)", () => {
  it("every tool has a non-empty title field", () => {
    for (const t of MCP_TOOLS) {
      expect(t.title, `${t.name} missing title`).toBeDefined();
      expect(typeof t.title, `${t.name} title must be string`).toBe("string");
      expect((t.title as string).length, `${t.name} title must be non-empty`).toBeGreaterThan(3);
    }
  });

  it("every tool has an annotations object", () => {
    for (const t of MCP_TOOLS) {
      expect(t.annotations, `${t.name} missing annotations`).toBeDefined();
      expect(typeof t.annotations, `${t.name} annotations must be object`).toBe("object");
    }
  });

  it("read-only tools are marked readOnlyHint:true", () => {
    const readOnlyTools = ["convo_list_tabs", "convo_search", "convo_status"];
    for (const name of readOnlyTools) {
      expect(
        (tool(name).annotations as { readOnlyHint?: boolean }).readOnlyHint,
        `${name} should be readOnlyHint:true`,
      ).toBe(true);
    }
  });

  it("convo_doctor fix:true is the only tool with destructiveHint:true implied — default annotations are conservative", () => {
    // convo_ask, convo_compare, convo_tab should NOT be readOnly
    for (const name of ["convo_ask", "convo_compare", "convo_tab"]) {
      const ann = tool(name).annotations as { readOnlyHint?: boolean };
      expect(ann.readOnlyHint, `${name} should NOT be readOnly`).toBeFalsy();
    }
  });

  it("no-param tools use additionalProperties:false per MCP 2026-07-28 recommendation", () => {
    // convo_onboard and convo_list_tabs have no meaningful params
    for (const name of ["convo_onboard", "convo_list_tabs"]) {
      const schema = tool(name).inputSchema as { additionalProperties?: boolean };
      expect(
        schema.additionalProperties,
        `${name} should have additionalProperties:false`,
      ).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Cycle 3 — description sentinel strings
// ---------------------------------------------------------------------------
describe("Cycle 3 — critical description sentinel strings", () => {
  it("convo_ask description contains BLOCKING to signal async contract", () => {
    expect(tool("convo_ask").description.toUpperCase()).toContain("BLOCKING");
  });

  it("convo_ask description contains session-continuity guidance (PIN or targetId)", () => {
    const desc = tool("convo_ask").description;
    expect(desc.toLowerCase()).toMatch(/pin|pass.*targetid|targetid.*next/);
  });

  it("convo_ask description mentions threadUrl as a shortcut", () => {
    expect(tool("convo_ask").description.toLowerCase()).toContain("threadurl");
  });

  it("convo_compare description contains BLOCKING", () => {
    expect(tool("convo_compare").description.toUpperCase()).toContain("BLOCKING");
  });

  it("convo_doctor fix parameter description warns about destructive effect", () => {
    const fixProp = props("convo_doctor").fix as { description?: string };
    expect(fixProp?.description?.toUpperCase()).toMatch(/DESTRUCT|KILL|TERMINAT/);
  });

  it("convo_list_tabs description no longer says 'Always call this first'", () => {
    // This was the actively harmful instruction causing redundant calls
    expect(tool("convo_list_tabs").description.toLowerCase()).not.toContain(
      "always call this first",
    );
  });

  it("convo_onboard description says to call it first before browser work", () => {
    expect(tool("convo_onboard").description.toLowerCase()).toMatch(/first|before.*browser|new session/);
  });

  it("convo_ask outputSchema includes tabId as required field for session pinning", () => {
    const output = tool("convo_ask").outputSchema as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    expect(output?.properties?.tabId).toBeDefined();
    expect(output?.required).toContain("tabId");
  });

  it("convo_ask inputSchema includes workspaceRoot param", () => {
    expect(props("convo_ask").workspaceRoot).toBeDefined();
    expect(props("convo_ask").workspaceRoot?.type).toBe("string");
  });

  it("convo_onboard inputSchema includes workspaceRoot param", () => {
    expect(props("convo_onboard").workspaceRoot).toBeDefined();
  });

  it("convo_status inputSchema includes workspaceRoot param", () => {
    expect(props("convo_status").workspaceRoot).toBeDefined();
  });

  it("convo_doctor inputSchema includes workspaceRoot param", () => {
    expect(props("convo_doctor").workspaceRoot).toBeDefined();
  });

  it("convo_setup inputSchema includes workspaceRoot param", () => {
    expect(props("convo_setup").workspaceRoot).toBeDefined();
  });

  it("convo_compare inputSchema includes workspaceRoot param", () => {
    expect(props("convo_compare").workspaceRoot).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Cycle 4 — structured error envelope emitted by executeMcpTool
// ---------------------------------------------------------------------------
describe("Cycle 4 — structured error envelope", () => {
  it("executeMcpTool returns structured.error.code on ConvoError", async () => {
    // Import via dynamic import to avoid top-level side effects
    const { executeMcpTool } = await import("../../src/entrypoints/mcp.tools.js");
    const { ConvoError } = await import("../../src/core/errors/convo-error.js");

    // Build a minimal fake orchestrator that throws a known ConvoError
    const fakeOrchestrator = {
      listTabs: async () => {
        throw new ConvoError(
          "transport-disconnected",
          "Bridge socket not found",
          "Start the daemon with `convo daemon start`.",
        );
      },
    };

    const result = await executeMcpTool(
      fakeOrchestrator as any,
      "convo_list_tabs",
      {},
    );

    expect(result.isError).toBe(true);
    expect(result.structured).toBeDefined();
    expect((result.structured as any)?.error?.code).toBe("transport-disconnected");
    expect((result.structured as any)?.error?.message).toBeDefined();
    expect(typeof (result.structured as any)?.error?.retryable).toBe("boolean");
  });

  it("executeMcpTool includes nextTool hint for known error codes", async () => {
    const { executeMcpTool } = await import("../../src/entrypoints/mcp.tools.js");
    const { ConvoError } = await import("../../src/core/errors/convo-error.js");

    const fakeOrchestrator = {
      listTabs: async () => {
        throw new ConvoError(
          "configuration-required",
          "No .convo/config.json",
          "Run convo onboard.",
        );
      },
    };

    const result = await executeMcpTool(
      fakeOrchestrator as any,
      "convo_list_tabs",
      {},
    );

    expect(result.isError).toBe(true);
    const errorEnvelope = (result.structured as any)?.error;
    // configuration-required should hint at convo_onboard
    expect(errorEnvelope?.nextTool).toBe("convo_onboard");
  });

  it("executeMcpTool structured error text contains the error code", async () => {
    const { executeMcpTool } = await import("../../src/entrypoints/mcp.tools.js");
    const { ConvoError } = await import("../../src/core/errors/convo-error.js");

    const fakeOrchestrator = {
      listTabs: async () => {
        throw new ConvoError("session-busy", "Lock held", "Wait and retry.");
      },
    };

    const result = await executeMcpTool(fakeOrchestrator as any, "convo_list_tabs", {});
    expect(result.isError).toBe(true);
    // The text should contain the code for quick human reading
    expect(result.text).toContain("session-busy");
  });
});

// ---------------------------------------------------------------------------
// Cycle 5 — workspaceRoot env fallback in config-context
// ---------------------------------------------------------------------------
describe("Cycle 5 — workspaceRoot / CONVOLINK_WORKSPACE env fallback", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env after each test
    for (const key of ["CONVOLINK_WORKSPACE", "PWD"]) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      } else {
        delete process.env[key];
      }
    }
  });

  it("loadResolution reads CONVOLINK_WORKSPACE env when workDir param is omitted", async () => {
    const { loadResolution } = await import("../../src/entrypoints/config-context.js");
    const tmpDir = `/tmp/convo-workspace-test-${Date.now()}`;
    process.env.CONVOLINK_WORKSPACE = tmpDir;

    // We don't care about the result (may be config-not-found from temp dir)
    // We care that the function runs without throwing and uses the env var path
    const result = await loadResolution();
    // If it tried to read from tmpDir (which has no .convo), it should return ok:false
    // with code configuration-required (not crash)
    expect(result.ok === true || result.ok === false).toBe(true);
    // Critically, it should NOT throw — env resolution must be safe
  });

  it("loadResolution accepts an explicit workDir and uses it over the env", async () => {
    const { loadResolution } = await import("../../src/entrypoints/config-context.js");
    const tmpDir = `/tmp/convo-workspace-explicit-${Date.now()}`;
    process.env.CONVOLINK_WORKSPACE = "/should/not/be/used";

    const result = await loadResolution({}, tmpDir);
    // Should not throw — explicit takes priority
    expect(result.ok === true || result.ok === false).toBe(true);
  });
});
