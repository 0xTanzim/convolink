import type {
  BrowserPort,
  BrowserCapabilities,
  SessionHandle,
  TabDescriptor,
  TransportHealth,
} from "../../core/ports/browser.port.js";
import { BrowserConnectionError } from "../../core/errors/bridge-errors.js";

export type CommandExecutor = (
  args: string[],
) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

/**
 * AgentBrowserAdapter drives Chrome using the agent-browser CLI binary over CDP.
 * Respects safe detach semantics (never terminates the browser).
 */
export class AgentBrowserAdapter implements BrowserPort {
  public readonly id = "agent-browser" as const;
  public readonly capabilities: BrowserCapabilities = {
    protocol: "cdp",
    browserFamily: "chromium",
    supportsBackgroundLifecycle: false,
    supportsFileDownloads: false,
    supportsTabManagement: true,
  };
  private readonly port: number;
  private readonly execute: CommandExecutor;

  constructor(port: number = 9222, executor?: CommandExecutor) {
    this.port = port;
    this.execute = executor ?? this.defaultSpawnExecutor;
  }

  public async health(): Promise<TransportHealth> {
    const start = Date.now();
    try {
      const tabs = await this.listTabs();
      return {
        ok: true,
        adapterId: this.id,
        endpoint: `http://127.0.0.1:${this.port}`,
        openTabsCount: tabs.length,
        latencyMs: Date.now() - start,
      };
    } catch (err: unknown) {
      return {
        ok: false,
        adapterId: this.id,
        endpoint: `http://127.0.0.1:${this.port}`,
        openTabsCount: 0,
        latencyMs: Date.now() - start,
        error: (err as Error).message,
      };
    }
  }

  public async listTabs(): Promise<TabDescriptor[]> {
    const res = await this.execute(["--cdp", String(this.port), "tab", "list"]);
    if (res.exitCode !== 0) {
      throw new BrowserConnectionError(`127.0.0.1:${this.port}`, res.stderr || "tab list failed");
    }

    const lines = res.stdout.split("\n");
    const tabs: TabDescriptor[] = [];

    for (const rawLine of lines) {
      const line = rawLine.trim().replace(/^[→*]\s*/, "");
      // Matches pattern: [t1] Title text - https://url
      const match = line.match(/^\[(t\d+)\]\s+(.*?)\s+-\s+(https?:\/\/\S+)/);
      if (match && match[1] && match[2] && match[3]) {
        tabs.push({
          targetId: match[1],
          title: match[2].trim(),
          url: match[3].trim(),
        });
      }
    }

    return tabs;
  }

  public async attach(targetId: string): Promise<SessionHandle> {
    const res = await this.execute(["--cdp", String(this.port), "tab", targetId]);
    if (res.exitCode !== 0) {
      throw new BrowserConnectionError(`127.0.0.1:${this.port}`, `Failed to attach to tab ${targetId}`);
    }

    return {
      sessionId: `agent-browser-${targetId}-${Date.now()}`,
      targetId,
      adapterId: this.id,
    };
  }

  public async detach(_handle: SessionHandle): Promise<void> {
    // Explicitly NO-OP or disconnect; NEVER kill user's browser process
  }

  public async keepAliveInBackground(handle: SessionHandle): Promise<void> {
    // Run CDP focus emulation & active lifecycle commands via eval
    const expression = `(() => {
      try {
        window.focus();
        document.dispatchEvent(new Event('focus'));
      } catch {}
    })()`;
    await this.evaluate(handle, expression).catch(() => {});
  }

  public async bringToFront(handle: SessionHandle): Promise<void> {
    await this.execute(["--cdp", String(this.port), "tab", handle.targetId]);
  }

  public async evaluate<T>(handle: SessionHandle, expression: string): Promise<T> {
    const res = await this.execute([
      "--cdp",
      String(this.port),
      "tab",
      handle.targetId,
      "eval",
      expression,
    ]);

    if (res.exitCode !== 0) {
      throw new Error(`agent-browser eval failed: ${res.stderr || res.stdout}`);
    }

    const output = res.stdout.trim();
    try {
      return JSON.parse(output) as T;
    } catch {
      return output as unknown as T;
    }
  }

  public async fillText(handle: SessionHandle, selector: string, text: string): Promise<void> {
    await this.execute(["--cdp", String(this.port), "tab", handle.targetId, "fill", selector, text]);
  }

  public async click(handle: SessionHandle, selector: string): Promise<void> {
    await this.execute(["--cdp", String(this.port), "tab", handle.targetId, "click", selector]);
  }

  public async pressKey(handle: SessionHandle, selector: string, key: string): Promise<void> {
    await this.execute(["--cdp", String(this.port), "tab", handle.targetId, "press", key]);
  }

  public async setInputFiles(handle: SessionHandle, selector: string, filePaths: string[]): Promise<void> {
    await this.execute(["--cdp", String(this.port), "tab", handle.targetId, "upload", selector, ...filePaths]);
  }

  public async createTab(url: string): Promise<TabDescriptor> {
    const res = await this.execute(["--cdp", String(this.port), "tab", "new", url]);
    if (res.exitCode !== 0) {
      throw new BrowserConnectionError(`127.0.0.1:${this.port}`, res.stderr || "tab new failed");
    }
    const match = res.stdout.match(/\[(t\d+)\]/);
    const targetId = match && match[1] ? match[1] : `tab-${Date.now()}`;
    return { targetId, url, title: `Tab ${targetId}` };
  }

  public async closeTab(targetId: string): Promise<void> {
    await this.execute(["--cdp", String(this.port), "tab", "close", targetId]);
  }

  public async navigate(handle: SessionHandle, url: string): Promise<void> {
    await this.execute(["--cdp", String(this.port), "tab", handle.targetId, "open", url]);
  }

  public async goBack(handle: SessionHandle): Promise<void> {
    await this.execute(["--cdp", String(this.port), "tab", handle.targetId, "back"]);
  }

  private async defaultSpawnExecutor(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(["agent-browser", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { stdout, stderr, exitCode };
  }
}
