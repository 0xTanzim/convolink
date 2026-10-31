import { describe, expect, it } from "bun:test";
import { AgentBrowserAdapter } from "../../src/adapters/browsers/agent-browser.adapter.js";
import type { SessionHandle } from "../../src/core/ports/browser.port.js";

describe("AgentBrowserAdapter", () => {
  const fakeExecutor = async (args: string[]) => {
    const fullCmd = args.join(" ");

    if (fullCmd.includes("tab list")) {
      return {
        stdout: `  [t1] DeepSeek Chat - https://chat.deepseek.com/a/chat/s/123\n  [t2] ChatGPT - https://chatgpt.com/c/456`,
        stderr: "",
        exitCode: 0,
      };
    }

    if (fullCmd.includes("eval")) {
      return {
        stdout: JSON.stringify({ result: "eval-success", count: 42 }),
        stderr: "",
        exitCode: 0,
      };
    }

    return { stdout: "ok", stderr: "", exitCode: 0 };
  };

  it("reports adapter id as agent-browser", () => {
    const adapter = new AgentBrowserAdapter(9222, fakeExecutor);
    expect(adapter.id).toBe("agent-browser");
  });

  it("lists tabs parsed from output", async () => {
    const adapter = new AgentBrowserAdapter(9222, fakeExecutor);
    const tabs = await adapter.listTabs();

    expect(tabs.length).toBe(2);
    expect(tabs[0]?.targetId).toBe("t1");
    expect(tabs[0]?.title).toBe("DeepSeek Chat");
    expect(tabs[0]?.url).toBe("https://chat.deepseek.com/a/chat/s/123");

    expect(tabs[1]?.targetId).toBe("t2");
    expect(tabs[1]?.title).toBe("ChatGPT");
  });

  it("attaches to target tab and returns session handle", async () => {
    const adapter = new AgentBrowserAdapter(9222, fakeExecutor);
    const handle = await adapter.attach("t1");

    expect(handle.targetId).toBe("t1");
    expect(handle.adapterId).toBe("agent-browser");
    expect(typeof handle.sessionId).toBe("string");
  });

  it("evaluates JavaScript expressions and parses JSON result", async () => {
    const adapter = new AgentBrowserAdapter(9222, fakeExecutor);
    const handle: SessionHandle = { sessionId: "s1", targetId: "t1", adapterId: "agent-browser" };

    const result = await adapter.evaluate<{ result: string; count: number }>(handle, "() => ({ result: 'eval-success', count: 42 })");
    expect(result.result).toBe("eval-success");
    expect(result.count).toBe(42);
  });

  it("detaches cleanly without closing browser process", async () => {
    let closed = false;
    const trackingExecutor = async (args: string[]) => {
      if (args.includes("close")) closed = true;
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const adapter = new AgentBrowserAdapter(9222, trackingExecutor);
    const handle: SessionHandle = { sessionId: "s1", targetId: "t1", adapterId: "agent-browser" };

    await adapter.detach(handle);
    expect(closed).toBe(false); // MUST NEVER CALL CLOSE
  });

  it("creates a new tab via agent-browser tab new", async () => {
    const executed: string[][] = [];
    const trackingExecutor = async (args: string[]) => {
      executed.push(args);
      if (args.includes("tab") && args.includes("new")) {
        return { stdout: "[t3] New Tab - https://chatgpt.com", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const adapter = new AgentBrowserAdapter(9222, trackingExecutor);
    const tab = await adapter.createTab("https://chatgpt.com");

    expect(tab.url).toBe("https://chatgpt.com");
    expect(executed.some((cmd) => cmd.includes("tab") && cmd.includes("new") && cmd.includes("https://chatgpt.com"))).toBe(true);
  });

  it("closes a specific tab via agent-browser tab close", async () => {
    const executed: string[][] = [];
    const trackingExecutor = async (args: string[]) => {
      executed.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const adapter = new AgentBrowserAdapter(9222, trackingExecutor);
    await adapter.closeTab("t3");

    expect(executed.some((cmd) => cmd.includes("tab") && cmd.includes("close") && cmd.includes("t3"))).toBe(true);
  });

  it("navigates and goes back via agent-browser", async () => {
    const executed: string[][] = [];
    const trackingExecutor = async (args: string[]) => {
      executed.push(args);
      return { stdout: "", stderr: "", exitCode: 0 };
    };

    const adapter = new AgentBrowserAdapter(9222, trackingExecutor);
    const handle: SessionHandle = { sessionId: "s1", targetId: "t1", adapterId: "agent-browser" };

    await adapter.navigate(handle, "https://chat.deepseek.com/");
    await adapter.goBack(handle);

    expect(executed.some((cmd) => cmd.includes("open") && cmd.includes("https://chat.deepseek.com/"))).toBe(true);
    expect(executed.some((cmd) => cmd.includes("back"))).toBe(true);
  });
});
