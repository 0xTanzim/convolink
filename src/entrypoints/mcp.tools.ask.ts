import type { SessionOrchestrator } from "../core/services/orchestrator.js";
import type { PlatformId } from "../core/ports/platform.port.js";
import { isContinuableThread, parseThreadUrl, type ThreadTarget } from "../core/services/setup/thread-target.js";
import { ensureMcpBrowserReady } from "./mcp.helpers.js";
import type { ExecuteToolOptions, McpToolExecutionResult } from "./mcp.tools.types.js";

export function threadFrom(raw: unknown): ThreadTarget | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const parsed = parseThreadUrl(raw);
  if (!parsed.ok) throw new Error(`${parsed.error.message} ${parsed.error.remediation}`);
  return parsed.target;
}

export function threadsFrom(raw: unknown): Partial<Record<PlatformId, ThreadTarget>> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const map: Partial<Record<PlatformId, ThreadTarget>> = {};
  for (const [platform, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") continue;
    const parsed = parseThreadUrl(value);
    if (!parsed.ok) throw new Error(`${parsed.error.message} ${parsed.error.remediation}`);
    if (parsed.target.platform !== platform) {
      throw new Error(`${value} is a ${parsed.target.platform} URL, not ${platform}.`);
    }
    map[platform as PlatformId] = parsed.target;
  }
  return Object.keys(map).length > 0 ? map : undefined;
}

export async function handleAsk(
  orchestrator: SessionOrchestrator,
  args: Record<string, unknown>,
  workDir: string | undefined,
  options?: ExecuteToolOptions,
): Promise<McpToolExecutionResult> {
  const browser = typeof args.browser === "string" ? args.browser : undefined;
  const profile = typeof args.profile === "string" ? args.profile : undefined;
  const browserReady = await ensureMcpBrowserReady(orchestrator, {
    browser,
    profile,
    ...(workDir ? { workDir } : {}),
    ...(options?.discoverProfiles ? { discoverProfiles: options.discoverProfiles } : {}),
  });
  if (!browserReady.ok) {
    return {
      text: browserReady.errorText ?? "Browser is not ready.",
      isError: true,
      structured: {
        error: {
          code: "browser-unreachable",
          message: browserReady.errorText ?? "Browser is not ready.",
          nextTool: "convo_doctor",
        },
      },
    };
  }
  const prompt = typeof args.prompt === "string" ? args.prompt : String(args.prompt ?? "");
  if (!prompt.trim()) {
    return {
      text: "Error: 'prompt' must not be empty.",
      isError: true,
      structured: {
        error: {
          code: "invalid-argument",
          message: "'prompt' must not be empty.",
          remediation: "Provide a non-empty prompt string.",
        },
      },
    };
  }
  const platform = typeof args.platform === "string" ? (args.platform as PlatformId) : undefined;
  const targetId = typeof args.targetId === "string" ? args.targetId : undefined;
  const writeFiles = typeof args.writeFiles === "boolean" ? args.writeFiles : undefined;
  const outDir = typeof args.outDir === "string" ? args.outDir : undefined;
  const newChat = typeof args.newChat === "boolean" ? args.newChat : undefined;
  const openTab = typeof args.openTab === "boolean" ? args.openTab : undefined;
  const think = typeof args.think === "boolean" ? args.think : undefined;
  const search = typeof args.search === "boolean" ? args.search : undefined;

  const thread = threadFrom(args.threadUrl);
  const res = await orchestrator.ask({
    prompt,
    platform,
    targetId,
    writeFiles,
    outDir,
    newChat,
    openTab,
    toggles: think !== undefined || search !== undefined ? { think, search } : undefined,
    ...(thread ? { thread } : {}),
    ...(options?.onProgress ? { progress: options.onProgress } : {}),
  });
  return {
    text: res.turn.markdownContent,
    writtenFiles: res.writtenFiles ?? [],
    riskLabels: res.riskLabels,
    redactedSecretsCount: res.redactedSecretsCount,
    structured: {
      platform: res.tab.platformId,
      tabId: res.tab.targetId,
      threadId: res.tab.threadId,
      threadUrl: res.tab.platformId && isContinuableThread(res.tab.platformId, res.tab.threadId) ? res.tab.url : null,
      elapsedMs: res.elapsedMs,
      continued: Boolean(thread) || !newChat,
      text: res.turn.markdownContent,
    },
  };
}

export async function handleCompare(
  orchestrator: SessionOrchestrator,
  args: Record<string, unknown>,
  workDir: string | undefined,
  options?: ExecuteToolOptions,
): Promise<McpToolExecutionResult> {
  const browser = typeof args.browser === "string" ? args.browser : undefined;
  const profile = typeof args.profile === "string" ? args.profile : undefined;
  const browserReady = await ensureMcpBrowserReady(orchestrator, {
    browser,
    profile,
    ...(workDir ? { workDir } : {}),
    ...(options?.discoverProfiles ? { discoverProfiles: options.discoverProfiles } : {}),
  });
  if (!browserReady.ok) {
    return {
      text: browserReady.errorText ?? "Browser is not ready.",
      isError: true,
      structured: {
        error: {
          code: "browser-unreachable",
          message: browserReady.errorText ?? "Browser is not ready.",
          nextTool: "convo_doctor",
        },
      },
    };
  }
  const prompt = typeof args.prompt === "string" ? args.prompt : String(args.prompt ?? "");
  if (!prompt.trim()) {
    return {
      text: "Error: 'prompt' must not be empty.",
      isError: true,
      structured: {
        error: {
          code: "invalid-argument",
          message: "'prompt' must not be empty.",
          remediation: "Provide a non-empty prompt string.",
        },
      },
    };
  }
  const platforms = Array.isArray(args.platforms) ? (args.platforms as PlatformId[]) : undefined;
  const arbitrate = typeof args.arbitrate === "boolean" ? args.arbitrate : undefined;
  const arbiter = typeof args.arbiter === "string" ? (args.arbiter as PlatformId) : undefined;
  const threads = threadsFrom(args.threads);
  const report = await orchestrator.compare({
    prompt,
    platforms,
    arbitrate,
    arbiter,
    ...(threads ? { threads } : {}),
    continueThreads: args.continue === true,
  });
  return {
    text: report.markdownReport,
    structured: {
      comparisonId: report.comparisonId,
      durationMs: report.totalDurationMs,
      platforms: report.results.map((result) => ({
        platform: result.platform,
        status: result.status,
        elapsedMs: result.elapsedMs,
        threadId: result.tab.threadId,
        threadUrl: isContinuableThread(result.platform, result.tab.threadId) ? result.tab.url : null,
      })),
    },
  };
}
