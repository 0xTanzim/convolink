import { describe, expect, it } from "bun:test";
import { MCP_TOOLS } from "../../src/entrypoints/mcp.schema.js";

const tool = (name: string) => MCP_TOOLS.find((candidate) => candidate.name === name)!;
const props = (name: string) => tool(name).inputSchema.properties as Record<string, Record<string, unknown>>;

describe("MCP tool schema standards", () => {
  it("declares a valid object input schema for every tool", () => {
    for (const definition of MCP_TOOLS) {
      expect(definition.name).toMatch(/^convo_[a-z_]+$/);
      expect(definition.description.length).toBeGreaterThan(20);
      expect(definition.inputSchema.type).toBe("object");
    }
  });

  it("constrains every fixed choice to an enum", () => {
    expect(props("convo_ask").platform!.enum).toEqual(["chatgpt", "deepseek", "gemini", "claude"]);
    expect(props("convo_ask").browser!.enum).toContain("firefox");
    expect(props("convo_compare").platforms!.items).toMatchObject({ enum: ["chatgpt", "deepseek", "gemini", "claude"] });
    expect(props("convo_setup").browser!.enum).toContain("zen");
    expect(props("convo_setup").transport!.enum).toContain("firefox-bidi");
    expect(props("convo_tab").action!.enum).toEqual(["new", "close", "back", "undo"]);
    expect(props("convo_thread").action!.enum).toEqual(["export", "resume", "history"]);
    expect(props("convo_profile").action!.enum).toEqual(["list", "select"]);
  });

  it("accepts conversation URLs on ask and per-platform threads on compare", () => {
    expect(props("convo_ask").threadUrl).toMatchObject({ type: "string", format: "uri" });
    expect(props("convo_compare").threads).toMatchObject({ type: "object" });
    expect((props("convo_compare").threads!.properties as Record<string, unknown>).chatgpt).toMatchObject({ format: "uri" });
    expect(props("convo_compare").continue).toMatchObject({ type: "boolean" });
  });

  it("declares output schemas so agents can read results without parsing prose", () => {
    for (const name of ["convo_ask", "convo_compare", "convo_status", "convo_list_tabs"]) {
      expect(tool(name).outputSchema).toBeDefined();
      expect(tool(name).outputSchema!.type).toBe("object");
    }
  });
});
