import { describe, expect, it, afterEach, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createContainer } from "../../src/container.js";
import { ExtensionBridgeAdapter } from "../../src/adapters/browsers/extension-bridge.adapter.js";
import { BridgeTokenService } from "../../src/core/services/bridge-token.service.js";
import { FakeThreadStore } from "../fakes/fake-storage.js";

describe("Extension Bridge End-to-End Provider Orchestration", () => {
  let tempDir: string;
  let tokenFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "convolink-orch-test-"));
    tokenFile = path.join(tempDir, "bridge-token.json");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("orchestrates ask workflow through extension-bridge transport", async () => {
    const tokenService = new BridgeTokenService(tokenFile);
    const validToken = tokenService.getToken();

    const threadStore = new FakeThreadStore();
    const adapter = new ExtensionBridgeAdapter(19240, tokenService);
    const container = createContainer({
      browser: adapter,
      threadStore,
    });

    const bridge = container.browser;
    await (bridge as any).start();

    // Connect simulated WXT companion extension
    const ws = new WebSocket("ws://127.0.0.1:19240");
    await new Promise<void>((r) => { ws.onopen = () => r(); });

    let handshaked = false;
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString());
      const reply = (result: unknown) => ws.send(JSON.stringify({ v: 2, id: msg.id, ok: true, result }));
      switch (msg.type) {
        case "HANDSHAKE_ACK":
          handshaked = msg.success === true;
          break;
        case "LIST_TABS":
          reply([{ tabId: 901, title: "ChatGPT Active Thread", url: "https://chatgpt.com/c/test-thread-123" }]);
          break;
        case "READ_THREAD":
          reply({
            layoutVariant: "companion-v2",
            turns: [
              { turnIndex: 0, role: "user", markdownContent: "Earlier unrelated request", codeBlocks: [], contentHash: "u" },
              {
                turnIndex: 1,
                role: "assistant",
                markdownContent: "Here is your helper file:\n```typescript\n// filepath: src/helper.ts\nexport const helper = 42;\n```",
                codeBlocks: [{ language: "typescript", code: "// filepath: src/helper.ts\nexport const helper = 42;\n" }],
                contentHash: "a",
              },
            ],
          });
          break;
        case "PROBE_SELECTORS":
          reply({
            ok: true,
            layoutVariant: "companion-v2",
            composerSelector: "div.ProseMirror[contenteditable='true']",
            sendButtonSelector: "button[data-testid='send-button']",
            stopIndicatorSelector: null,
            turnContainerSelector: "article",
          });
          break;
        case "PROBE_READY":
        case "PROBE_MOUNTED":
          reply(true);
          break;
        case "PROBE_QUIET":
          reply({ readyState: "complete", nodes: 10, text: 100 });
          break;
        case "PROBE_COMPOSER_TEXT":
          reply(false);
          break;
        case "GET_URL":
          reply("https://chatgpt.com/c/test-thread-123");
          break;
        case "PROBE_STATUS":
          reply({
            turnsCount: 2,
            turnIndex: 1,
            hasNewTurn: true,
            isGenerating: false,
            isThinking: false,
            assistantText: "Here is your helper file:\n```typescript\n// filepath: src/helper.ts\nexport const helper = 42;\n```",
            codeBlocks: [{ language: "typescript", code: "// filepath: src/helper.ts\nexport const helper = 42;\n" }],
          });
          break;
        case "PROBE_CONTINUATION":
          reply({ hasContinuation: false });
          break;
        case "INSPECT_CANVAS":
          reply(null);
          break;
        case "FILL_TEXT":
          reply({ ok: true });
          break;
        case "CLICK":
        case "PRESS_KEY":
        case "FOCUS":
        case "NAVIGATE":
          reply({ ok: true });
          break;
        case "CREATE_TAB":
          reply({ tabId: 902, title: "", url: "https://chatgpt.com/" });
          break;
        case "CLOSE_TAB":
          reply({ closed: true });
          break;
        default:
          reply(null);
      }
    };

    // Perform handshake with pairing token
    ws.send(JSON.stringify({
      type: "HANDSHAKE",
      protocolVersion: 2,
      clientId: "test-companion-client",
      installationProfileId: "prof-wxt-test",
      connectionId: "conn-wxt-1",
      browserFamily: "chrome",
      profileLabel: "Development",
      extensionVersion: "1.0.0",
      token: validToken,
    }));

    await new Promise((r) => setTimeout(r, 60));
    expect(handshaked).toBe(true);

    // Verify tabs discovery via extension-bridge
    const tabs = await container.orchestrator.listTabs();
    expect(tabs.length).toBe(1);
    expect(tabs[0]?.url).toContain("chatgpt.com");

    // Execute ask through orchestrator
    const reply = await container.orchestrator.ask({
      prompt: "Build me a helper",
      targetId: "901",
      timeoutMs: 5000,
    });

    expect(reply.turn.markdownContent).toContain("Here is your helper file");
    expect(reply.turn.role).toBe("assistant");
    expect(reply.artifacts?.length).toBe(1);
    expect(reply.artifacts?.[0]?.relativePath).toBe("src/helper.ts");

    // Verify durable ledger saved both turns
    const savedTurns = await threadStore.getTurns("test-thread-123");
    expect(savedTurns.length).toBe(2);
    expect(savedTurns[0]?.role).toBe("user");
    expect(savedTurns[0]?.markdownContent).toBe("Build me a helper");
    expect(savedTurns[1]?.role).toBe("assistant");
    expect(savedTurns[1]?.markdownContent).toContain("export const helper = 42;");

    // Clean up
    ws.close();
    await (bridge as any).stop();
  });
});
