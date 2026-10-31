import { describe, expect, it } from "bun:test";
import { handleSearch } from "../../src/entrypoints/cli.storage.js";

describe("CLI Storage Entrypoint: handleSearch", () => {
  it("defaults limit to 10 when --limit is omitted", async () => {
    let capturedQuery = "";
    let capturedLimit: number | undefined;

    const fakeOrchestrator = {
      searchLedger: async (query: string, limit?: number) => {
        capturedQuery = query;
        capturedLimit = limit;
        return [
          {
            threadId: "th-1",
            turnIndex: 0,
            role: "user" as const,
            snippet: "match snippet",
            timestamp: "2026-10-31T12:00:00Z",
          },
        ];
      },
    } as any;

    const code = await handleSearch(fakeOrchestrator, "authentication logic");
    expect(code).toBe(0);
    expect(capturedQuery).toBe("authentication logic");
    expect(capturedLimit).toBe(10);
  });

  it("parses --limit <n> from the end of the query and strips it", async () => {
    let capturedQuery = "";
    let capturedLimit: number | undefined;

    const fakeOrchestrator = {
      searchLedger: async (query: string, limit?: number) => {
        capturedQuery = query;
        capturedLimit = limit;
        return [];
      },
    } as any;

    const code = await handleSearch(fakeOrchestrator, "authentication logic --limit 5");
    expect(code).toBe(0);
    expect(capturedQuery).toBe("authentication logic");
    expect(capturedLimit).toBe(5);
  });

  it("parses --limit <n> from the beginning or middle of the query and strips it", async () => {
    let capturedQuery = "";
    let capturedLimit: number | undefined;

    const fakeOrchestrator = {
      searchLedger: async (query: string, limit?: number) => {
        capturedQuery = query;
        capturedLimit = limit;
        return [];
      },
    } as any;

    const code = await handleSearch(fakeOrchestrator, "--limit 3 database connection");
    expect(code).toBe(0);
    expect(capturedQuery).toBe("database connection");
    expect(capturedLimit).toBe(3);
  });

  it("returns exit code 1 if query is empty after stripping --limit", async () => {
    let called = false;
    const fakeOrchestrator = {
      searchLedger: async () => {
        called = true;
        return [];
      },
    } as any;

    const code = await handleSearch(fakeOrchestrator, "--limit 5");
    expect(code).toBe(1);
    expect(called).toBe(false);
  });
});
