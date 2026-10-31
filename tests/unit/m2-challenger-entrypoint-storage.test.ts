import { describe, expect, it } from "bun:test";
import { MCP_TOOLS, executeMcpTool } from "../../src/entrypoints/mcp.tools.js";
import { McpServer } from "../../src/entrypoints/mcp.server.js";
import { parseAskArgs, parseCompareArgs } from "../../src/entrypoints/cli.args.js";
import { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { FakeThreadStore } from "../fakes/fake-storage.js";
import { DeepSeekDriver } from "../../src/adapters/platforms/deepseek.driver.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { PolicyService } from "../../src/core/services/policy.service.js";
import { ArtifactService } from "../../src/core/services/artifact.service.js";
import type { WorkspaceSinkPort } from "../../src/core/ports/storage.port.js";
import type { ConversationTurn } from "../../src/core/ports/platform.port.js";
import type { ContextPacket } from "../../src/core/ports/compiler.port.js";

describe("Milestone 2 Challenger Suite: MCP, CLI & Storage", () => {
  // --------------------------------------------------------------------------
  // Area 1: MCP convo_ask Schema, Execution Metadata & Notifications
  // --------------------------------------------------------------------------
  describe("Area 1: MCP Schema, Execution & JSON-RPC Notifications", () => {
    it("empirically verifies convo_ask schema contains targetId, writeFiles, and outDir", () => {
      const askTool = MCP_TOOLS.find((t) => t.name === "convo_ask");
      expect(askTool).toBeDefined();

      const properties = askTool!.inputSchema.properties as Record<string, { type: string; description: string }>;
      expect(properties.targetId).toBeDefined();
      expect(properties.targetId?.type).toBe("string");
      expect(properties.writeFiles).toBeDefined();
      expect(properties.writeFiles?.type).toBe("boolean");
      expect(properties.outDir).toBeDefined();
      expect(properties.outDir?.type).toBe("string");

      // Verify required fields
      expect(askTool!.inputSchema.required).toEqual(["prompt"]);
    });

    it("verifies tool call execution returns writtenFiles, riskLabels, and redactedSecretsCount", async () => {
      const browser = new FakeBrowserPort();
      browser.evalResponseMap.set("resolveSelectors", {
        ok: true, layoutVariant: "v1", composerSelector: "textarea", sendButtonSelector: "button",
        stopIndicatorSelector: null, turnContainerSelector: ".turn",
      });
      browser.evalResponseMap.set("awaitCompletion", {
        mdCount: 1, hasNewTurn: true, isGenerating: false, turnIndex: 0,
        text: "Dangerous command: `rm -rf /tmp/test`\n```ts\n// filepath: generated.ts\nexport const x = 42;\n```",
        codeBlocks: [{ language: "ts", code: "// filepath: generated.ts\nexport const x = 42;" }],
      });

      const fakeFileSink: WorkspaceSinkPort = {
        persist: async (artifacts, options) => ({
          writtenFiles: artifacts.map((a) => ({
            path: `${options.outDir}/${a.relativePath}`,
            relativePath: a.relativePath,
            bytes: a.content.length,
          })),
          skippedFiles: [],
        }),
      };

      const orchestrator = new SessionOrchestrator({
        browser,
        drivers: [new DeepSeekDriver()],
        lockService: new LockService(),
        policyGate: new PolicyService(),
        artifactService: new ArtifactService(),
        fileSink: fakeFileSink,
      });

      const server = new McpServer(orchestrator);

      // Tool call with a secret and writeFiles enabled
      const response = await server.handleMessage({
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "convo_ask",
          arguments: {
            prompt: "Please review token ghp_123456789012345678901234567890123456",
            platform: "deepseek",
            writeFiles: true,
            outDir: "./output-artifacts",
          },
        },
      });

      expect(response).not.toBeNull();
      expect(response?.id).toBe("call-1");
      const result = response?.result;
      expect(result).toBeDefined();

      // Verify return properties
      expect(Array.isArray(result?.writtenFiles)).toBe(true);
      expect(result?.writtenFiles).toContain("./output-artifacts/generated.ts");

      expect(Array.isArray(result?.riskLabels)).toBe(true);
      expect(result?.riskLabels).toContain("contains_destructive_command");

      expect(typeof result?.redactedSecretsCount).toBe("number");
      expect(result?.redactedSecretsCount).toBe(1);
    });

    it("verifies un-id'd JSON-RPC notifications and null-id requests return null without crashing", async () => {
      const orchestrator = new SessionOrchestrator({
        browser: new FakeBrowserPort(),
        drivers: [new DeepSeekDriver()],
        lockService: new LockService(),
        policyGate: new PolicyService(),
      });
      const server = new McpServer(orchestrator);

      // Standard notification
      expect(await server.handleMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();

      // Method call without id
      expect(await server.handleMessage({ jsonrpc: "2.0", method: "tools/call", params: { name: "convo_ask" } })).toBeNull();

      // id: null
      expect(await server.handleMessage({ jsonrpc: "2.0", id: null, method: "ping" })).toBeNull();

      // Unknown method sent as notification (must NOT return error response)
      expect(await server.handleMessage({ jsonrpc: "2.0", method: "unknown/notify" })).toBeNull();

      // Valid requests with 0 or string ID must still respond
      const resZero = await server.handleMessage({ jsonrpc: "2.0", id: 0, method: "ping" });
      expect(resZero).not.toBeNull();
      expect(resZero?.id).toBe(0);

      const resString = await server.handleMessage({ jsonrpc: "2.0", id: "str-id-99", method: "ping" });
      expect(resString).not.toBeNull();
      expect(resString?.id).toBe("str-id-99");
    });
  });

  // --------------------------------------------------------------------------
  // Area 2: CLI Argument Parser Aliases & Boundary Conditions
  // --------------------------------------------------------------------------
  describe("Area 2: CLI Argument Aliases & Boundary Resilience", () => {
    it("verifies parseAskArgs parses -p, -t, --targetId, and -o aliases", () => {
      const parsedShort = parseAskArgs(["-p", "deepseek", "-t", "tab-42", "-o", "./short-out", "hello"]);
      expect(parsedShort.platform).toBe("deepseek");
      expect(parsedShort.targetId).toBe("tab-42");
      expect(parsedShort.outDir).toBe("./short-out");
      expect(parsedShort.prompt).toBe("hello");

      const parsedTargetId = parseAskArgs(["--targetId", "tab-99", "check tab"]);
      expect(parsedTargetId.targetId).toBe("tab-99");
      expect(parsedTargetId.prompt).toBe("check tab");

      const parsedLong = parseAskArgs(["--platform", "gemini", "--target", "tab-100", "--out-dir", "./long-out", "hi"]);
      expect(parsedLong.platform).toBe("gemini");
      expect(parsedLong.targetId).toBe("tab-100");
      expect(parsedLong.outDir).toBe("./long-out");
      expect(parsedLong.prompt).toBe("hi");
    });

    it("verifies parseCompareArgs parses -o alias identically to --out-dir", () => {
      const parsedShort = parseCompareArgs(["-o", "./cmp-short", "--platforms", "chatgpt,deepseek", "compare"]);
      expect(parsedShort.outDir).toBe("./cmp-short");
      expect(parsedShort.platforms).toEqual(["chatgpt", "deepseek"]);
      expect(parsedShort.prompt).toBe("compare");

      const parsedLong = parseCompareArgs(["--out-dir", "./cmp-long", "compare"]);
      expect(parsedLong.outDir).toBe("./cmp-long");
      expect(parsedLong.prompt).toBe("compare");
    });

    it("stress-tests CLI parser against boundary inputs without values and mixed flags", () => {
      // Flag at end without value should not throw or crash
      const trailingFlag = parseAskArgs(["my prompt", "-p"]);
      expect(trailingFlag.prompt).toBe("my prompt");
      expect(trailingFlag.platform).toBeUndefined();

      const trailingTarget = parseAskArgs(["-t"]);
      expect(trailingTarget.targetId).toBeUndefined();

      const trailingOut = parseCompareArgs(["-o"]);
      expect(trailingOut.outDir).toBeUndefined();

      // Interspersed flags and prompt words
      const mixed = parseAskArgs(["word1", "-p", "claude", "word2", "-w", "-o", "./dir", "word3", "--think"]);
      expect(mixed.prompt).toBe("word1 word2 word3");
      expect(mixed.platform).toBe("claude");
      expect(mixed.writeFiles).toBe(true);
      expect(mixed.outDir).toBe("./dir");
      expect(mixed.toggles.think).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Area 3: Symmetric Ledger Recording in SessionOrchestrator
  // --------------------------------------------------------------------------
  describe("Area 3: Symmetric Ledger Recording", () => {
    it("records user turn at turn N and assistant turn at turn N+1 monotonically", async () => {
      const browser = new FakeBrowserPort();
      browser.evalResponseMap.set("resolveSelectors", {
        ok: true, layoutVariant: "v1", composerSelector: "textarea", sendButtonSelector: "button",
        stopIndicatorSelector: null, turnContainerSelector: ".turn",
      });

      let turnCount = 0;
      browser.evalResponseMap.set("awaitCompletion", {
        mdCount: 1, hasNewTurn: true, isGenerating: false, turnIndex: 0,
        text: "Assistant response 1", codeBlocks: [],
      });

      const store = new FakeThreadStore();
      const orchestrator = new SessionOrchestrator({
        browser,
        drivers: [new DeepSeekDriver()],
        lockService: new LockService(),
        policyGate: new PolicyService(),
        threadStore: store,
      });

      // Turn Batch 1
      await orchestrator.ask({ prompt: "User prompt 1", platform: "deepseek" });

      const threads = await store.listThreads();
      expect(threads.length).toBe(1);
      const threadId = threads[0]!.threadId;

      let turns = await store.getTurns(threadId);
      expect(turns.length).toBe(2);
      expect(turns[0]?.role).toBe("user");
      expect(turns[0]?.turnIndex).toBe(0);
      expect(turns[0]?.markdownContent).toBe("User prompt 1");
      expect(turns[1]?.role).toBe("assistant");
      expect(turns[1]?.turnIndex).toBe(1);
      expect(turns[1]?.markdownContent).toContain("Assistant response 1");

      expect((await store.getThread(threadId))?.lastSyncedTurnCount).toBe(2);

      // Update mock response for Turn Batch 2
      browser.evalResponseMap.set("awaitCompletion", {
        mdCount: 2, hasNewTurn: true, isGenerating: false, turnIndex: 1,
        text: "Assistant response 2", codeBlocks: [],
      });

      // Turn Batch 2 on same thread
      await orchestrator.ask({ prompt: "User prompt 2", platform: "deepseek" });

      turns = await store.getTurns(threadId);
      expect(turns.length).toBe(4);
      expect(turns[2]?.role).toBe("user");
      expect(turns[2]?.turnIndex).toBe(2);
      expect(turns[2]?.markdownContent).toBe("User prompt 2");
      expect(turns[3]?.role).toBe("assistant");
      expect(turns[3]?.turnIndex).toBe(3);
      expect(turns[3]?.markdownContent).toContain("Assistant response 2");

      expect((await store.getThread(threadId))?.lastSyncedTurnCount).toBe(4);
    });

    it("verifies secrets in user prompt are scrubbed before writing to durable ledger", async () => {
      const browser = new FakeBrowserPort();
      browser.evalResponseMap.set("resolveSelectors", {
        ok: true, layoutVariant: "v1", composerSelector: "textarea", sendButtonSelector: "button",
        stopIndicatorSelector: null, turnContainerSelector: ".turn",
      });
      browser.evalResponseMap.set("awaitCompletion", {
        mdCount: 1, hasNewTurn: true, isGenerating: false, turnIndex: 0,
        text: "Safe response", codeBlocks: [],
      });

      const store = new FakeThreadStore();
      const orchestrator = new SessionOrchestrator({
        browser,
        drivers: [new DeepSeekDriver()],
        lockService: new LockService(),
        policyGate: new PolicyService(),
        threadStore: store,
      });

      await orchestrator.ask({
        prompt: "Check key sk-12345678901234567890abcdef please",
        platform: "deepseek",
      });

      const thread = (await store.listThreads())[0]!;
      const turns = await store.getTurns(thread.threadId);
      expect(turns.length).toBe(2);
      // User turn in ledger must have secret redacted
      expect(turns[0]?.markdownContent).not.toContain("sk-12345678901234567890abcdef");
      expect(turns[0]?.markdownContent).toContain("[REDACTED_SECRET]");
    });
  });

  // --------------------------------------------------------------------------
  // Area 4: FakeThreadStore Storage Fidelity, Turn Slicing & Search
  // --------------------------------------------------------------------------
  describe("Area 4: FakeThreadStore In-Memory Fidelity, Slicing & Search", () => {
    it("verifies turn deduplication and out-of-order sorting in appendTurns", async () => {
      const store = new FakeThreadStore();

      // Insert turns out-of-order
      const turns: ConversationTurn[] = [
        { turnIndex: 3, role: "assistant", markdownContent: "T3", codeBlocks: [], contentHash: "h3" },
        { turnIndex: 0, role: "user", markdownContent: "T0", codeBlocks: [], contentHash: "h0" },
        { turnIndex: 2, role: "user", markdownContent: "T2", codeBlocks: [], contentHash: "h2" },
      ];
      await store.appendTurns("th-dedup", turns);

      // Verify sorted order
      let all = await store.getTurns("th-dedup");
      expect(all.map((t) => t.turnIndex)).toEqual([0, 2, 3]);

      // Overwrite an existing index and add missing index
      await store.appendTurns("th-dedup", [
        { turnIndex: 2, role: "user", markdownContent: "T2-Updated", codeBlocks: [], contentHash: "h2-new" },
        { turnIndex: 1, role: "assistant", markdownContent: "T1", codeBlocks: [], contentHash: "h1" },
      ]);

      all = await store.getTurns("th-dedup");
      expect(all.map((t) => t.turnIndex)).toEqual([0, 1, 2, 3]);
      expect(all[2]?.markdownContent).toBe("T2-Updated");
    });

    it("verifies turn slicing with lastNTurns boundary edge cases", async () => {
      const store = new FakeThreadStore();
      const fiveTurns: ConversationTurn[] = [0, 1, 2, 3, 4].map((i) => ({
        turnIndex: i, role: i % 2 === 0 ? "user" : "assistant",
        markdownContent: `Turn ${i}`, codeBlocks: [], contentHash: `h${i}`,
      }));
      await store.appendTurns("th-slice", fiveTurns);

      // Normal slice of last 2 turns
      const last2 = await store.getTurns("th-slice", 2);
      expect(last2.length).toBe(2);
      expect(last2.map((t) => t.turnIndex)).toEqual([3, 4]);

      // Slice exceeding available turn count
      const exceed = await store.getTurns("th-slice", 100);
      expect(exceed.length).toBe(5);
      expect(exceed.map((t) => t.turnIndex)).toEqual([0, 1, 2, 3, 4]);

      // lastNTurns = 0 returns all turns
      const zero = await store.getTurns("th-slice", 0);
      expect(zero.length).toBe(5);

      // Non-existent thread returns empty array
      const nonExistent = await store.getTurns("non-existent");
      expect(nonExistent).toEqual([]);
    });

    it("verifies case-insensitive search with limit and snippet bounds across multiple threads", async () => {
      const store = new FakeThreadStore();
      await store.appendTurns("thread-alpha", [
        { turnIndex: 0, role: "user", markdownContent: "Prefix text ... SEARCH_TARGET_KEYWORD ... suffix text", codeBlocks: [], contentHash: "h1" },
      ]);
      await store.appendTurns("thread-beta", [
        { turnIndex: 0, role: "user", markdownContent: "Another turn with search_target_keyword here", codeBlocks: [], contentHash: "h2" },
        { turnIndex: 1, role: "assistant", markdownContent: "No match here", codeBlocks: [], contentHash: "h3" },
      ]);

      // Case-insensitive search
      const results = await store.searchTurns("search_target_keyword");
      expect(results.length).toBe(2);
      expect(results.some((r) => r.threadId === "thread-alpha")).toBe(true);
      expect(results.some((r) => r.threadId === "thread-beta")).toBe(true);

      // Limit capping
      const limited = await store.searchTurns("search_target_keyword", 1);
      expect(limited.length).toBe(1);

      // No match
      const emptyRes = await store.searchTurns("completely_absent_query");
      expect(emptyRes).toEqual([]);
    });

    it("verifies ContextPacket storage and chronological retrieval", async () => {
      const store = new FakeThreadStore();
      const mockStructured = {
        activeInvariants: [], settledDecisions: [], discardedApproaches: [],
        canonicalInterfaces: [], immediateDirective: "none",
      };

      const packetOlder: ContextPacket = {
        projectId: "proj-sync", packetHash: "hash-older", sourceThreadId: "th-p",
        platform: "claude", sourceTurnRange: [0, 2], layoutVariant: "standard",
        compiledAt: "2026-10-31T08:00:00Z", markdownBody: "Old body", structured: mockStructured,
      };

      const packetNewer: ContextPacket = {
        projectId: "proj-sync", packetHash: "hash-newer", sourceThreadId: "th-p",
        platform: "claude", sourceTurnRange: [0, 4], layoutVariant: "standard",
        compiledAt: "2026-10-31T14:00:00Z", markdownBody: "New body", structured: mockStructured,
      };

      await store.savePacket(packetOlder);
      await store.savePacket(packetNewer);

      // Retrieve by sourceThreadId
      const latestThread = await store.getLatestPacket("th-p");
      expect(latestThread?.packetHash).toBe("hash-newer");

      // Retrieve by projectId
      const latestProj = await store.getLatestPacket("proj-sync");
      expect(latestProj?.packetHash).toBe("hash-newer");

      // Clear store
      store.clear();
      expect(await store.getLatestPacket("th-p")).toBeNull();
      expect(await store.getThread("any")).toBeNull();
      expect(await store.getTurns("any")).toEqual([]);
    });
  });
});
