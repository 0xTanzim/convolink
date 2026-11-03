import { describe, expect, it } from "bun:test";
import { SessionOrchestrator } from "../../src/core/services/orchestrator.js";
import { FakeBrowserPort } from "../fakes/fake-browser.js";
import { ChatGPTDriver } from "../../src/adapters/platforms/chatgpt.driver.js";
import { LockService } from "../../src/core/services/lock.service.js";
import { PolicyService } from "../../src/core/services/policy.service.js";
import { ArtifactService } from "../../src/core/services/artifact.service.js";
import { WorkspaceFileSinkAdapter } from "../../src/adapters/storage/workspace-sink.adapter.js";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

describe("SessionOrchestrator Artifacts & Continuation", () => {
  const tmpOutDir = path.join(os.tmpdir(), `convo-orch-test-${Date.now()}`);

  it("extracts code artifacts and writes them to workspace when writeFiles: true", async () => {
    const browser = new FakeBrowserPort();
    browser.listTabs = async () => [
      { targetId: "tab-gpt-art", title: "ChatGPT", url: "https://chatgpt.com/c/gpt-1" },
    ];
    browser.evalResponseMap.set("submitPrompt", {
      turnCount: 0,
      lastTurnHash: "0",
      submittedPromptHash: "10",
    });
    browser.evalResponseMap.set("awaitCompletion", {
      turnsCount: 2,
      hasNewTurn: true,
      isGenerating: false,
      assistantText: "Here is your file:\n```typescript\n// filepath: math.ts\nexport const add = (a, b) => a + b;\n```",
      codeBlocks: [{ language: "typescript", code: "// filepath: math.ts\nexport const add = (a, b) => a + b;" }],
    });

    const orchestrator = new SessionOrchestrator({
      browser,
      drivers: [new ChatGPTDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
      artifactService: new ArtifactService(),
      fileSink: new WorkspaceFileSinkAdapter(),
    });

    const result = await orchestrator.ask({
      prompt: "Write math.ts",
      platform: "chatgpt",
      writeFiles: true,
      outDir: tmpOutDir,
    });

    expect(result.artifacts?.length).toBe(1);
    expect(result.artifacts?.[0]?.relativePath).toBe("math.ts");
    expect(result.writtenFiles?.length).toBe(1);
    expect(fs.existsSync(path.join(tmpOutDir, "math.ts"))).toBe(true);
  });

  it("executes continuation loop when model response is truncated", async () => {
    const browser = new FakeBrowserPort();
    browser.listTabs = async () => [
      { targetId: "tab-gpt-cont", title: "ChatGPT", url: "https://chatgpt.com/c/gpt-2" },
    ];
    browser.evalResponseMap.set("submitPrompt", {
      turnCount: 0,
      lastTurnHash: "0",
      submittedPromptHash: "10",
    });

    let completionCount = 0;
    browser.evalResponseMap.set("awaitCompletion", {
      turnsCount: 2,
      hasNewTurn: true,
      isGenerating: false,
      assistantText: "Part 1 of long output...",
      codeBlocks: [],
    });

    // Mock continuation trigger
    let continuationChecked = false;
    browser.evaluate = async (handle, expr) => {
      browser.evaluatedExpressions.push(expr);
      if (expr.includes("document.readyState")) return true as any;
      if (expr.includes("/* findContinuationTrigger */")) {
        if (!continuationChecked) {
          continuationChecked = true;
          return { hasContinuation: true, triggerSelector: "button" } as any;
        }
        return { hasContinuation: false } as any;
      }
      for (const [key, value] of browser.evalResponseMap.entries()) {
        if (expr.includes(key)) return value as any;
      }
      return {} as any;
    };

    const orchestrator = new SessionOrchestrator({
      browser,
      drivers: [new ChatGPTDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
    });

    const result = await orchestrator.ask({
      prompt: "Generate long text",
      platform: "chatgpt",
      autoContinue: true,
    });

    expect(continuationChecked).toBe(true);
    expect(result.turn.markdownContent).toContain("Part 1");
  });

  it("does not duplicate cumulative text when platform appends into same container", async () => {
    const browser = new FakeBrowserPort();
    browser.listTabs = async () => [
      { targetId: "tab-gpt-cont-dup", title: "ChatGPT", url: "https://chatgpt.com/c/gpt-dup" },
    ];
    browser.evalResponseMap.set("submitPrompt", {
      turnCount: 0,
      lastTurnHash: "0",
      submittedPromptHash: "10",
    });

    let awaitCount = 0;
    let continuationChecked = false;
    browser.evaluate = async (handle, expr) => {
      browser.evaluatedExpressions.push(expr);
      if (expr.includes("document.readyState")) return true as any;
      if (expr.includes("/* findContinuationTrigger */")) {
        if (!continuationChecked) {
          continuationChecked = true;
          return { hasContinuation: true, triggerSelector: "button" } as any;
        }
        return { hasContinuation: false } as any;
      }
      if (expr.includes("awaitCompletion")) {
        awaitCount++;
        if (awaitCount === 1) {
          return {
            turnsCount: 2,
            hasNewTurn: true,
            isGenerating: false,
            assistantText: "First section content.",
            codeBlocks: [],
          } as any;
        }
        // Second completion returns cumulative text from the same container
        return {
          turnsCount: 2,
          hasNewTurn: true,
          isGenerating: false,
          assistantText: "First section content. Second section content.",
          codeBlocks: [],
        } as any;
      }
      for (const [key, value] of browser.evalResponseMap.entries()) {
        if (expr.includes(key)) return value as any;
      }
      return {} as any;
    };

    const orchestrator = new SessionOrchestrator({
      browser,
      drivers: [new ChatGPTDriver()],
      lockService: new LockService(),
      policyGate: new PolicyService(),
    });

    const result = await orchestrator.ask({
      prompt: "Continue test",
      platform: "chatgpt",
      autoContinue: true,
    });

    // Content should NOT contain "First section content." twice
    const occurrences = result.turn.markdownContent.split("First section content.").length - 1;
    expect(occurrences).toBe(1);
    expect(result.turn.markdownContent).toBe("First section content. Second section content.");
  });
});
