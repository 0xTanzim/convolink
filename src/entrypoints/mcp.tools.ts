import type { SessionOrchestrator } from "../core/services/orchestrator.js";
import type { PlatformId } from "../core/ports/platform.port.js";
import { loadResolution } from "./config-context.js";
import { BrowserDiscoveryService, type DiscoveredProfile } from "../adapters/browsers/browser-discovery.js";
import type { ElicitationPort } from "./mcp.elicitation.js";
import { buildOnboardReport, type OnboardFacts } from "../core/services/onboarding.service.js";
import { collectOnboardFacts } from "./onboard.facts.js";
import { buildCapabilities } from "./cli.doctor.js";
import { applySetup } from "./cli.setup.js";
import { toConvoError } from "../core/errors/convo-error.js";
import type { BrowserId, TransportId } from "../core/ports/config.port.js";
import { isContinuableThread, parseThreadUrl, type ThreadTarget } from "../core/services/setup/thread-target.js";
import { isManagedTabRef } from "../adapters/browsers/tab-registry.js";
import {
  formatDoctorReport,
  runSelfHealingClean,
  getProfilesListText,
  selectProfile,
  ensureMcpBrowserReady,
} from "./mcp.helpers.js";
export { MCP_TOOLS, type McpToolDefinition } from "./mcp.schema.js";

export interface McpToolExecutionResult {
  readonly text: string;
  readonly isError?: boolean;
  /** Mirrors the declared outputSchema so clients need not parse prose. */
  readonly structured?: Record<string, unknown>;
  readonly writtenFiles?: readonly string[];
  readonly riskLabels?: readonly string[];
  readonly redactedSecretsCount?: number;
}

/** Setup verification launches a browser; this is the seam tests substitute. */
export type ApplySetupFn = typeof applySetup;

export interface ExecuteToolOptions {
  readonly workDir?: string;
  /** Test/logic seam: profile discovery touches the filesystem, so callers may inject it. */
  readonly discoverProfiles?: () => Promise<import("../adapters/browsers/browser-discovery.js").DiscoveredProfile[]>;
  /** Present only when the client advertised the MCP elicitation capability. */
  readonly elicitation?: ElicitationPort;
  /** Seam: setup verification starts a browser, so callers may substitute it. */
  readonly applySetupFn?: ApplySetupFn;
  /** Seam: onboarding reads daemon/extension/adapter state, so callers may substitute it. */
  readonly collectOnboardFacts?: () => Promise<OnboardFacts>;
  readonly onProgress?: { report(event: { stage: string; elapsedMs: number; platform?: string }): void };
}

function threadFrom(raw: unknown): ThreadTarget | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const parsed = parseThreadUrl(raw);
  if (!parsed.ok) throw new Error(`${parsed.error.message} ${parsed.error.remediation}`);
  return parsed.target;
}

function threadsFrom(raw: unknown): Partial<Record<PlatformId, ThreadTarget>> | undefined {
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

export async function executeMcpTool(
  orchestrator: SessionOrchestrator,
  name: string,
  args: Record<string, unknown> = {},
  options?: ExecuteToolOptions,
): Promise<McpToolExecutionResult> {
  try {
    switch (name) {
      case "convo_ask": {
        const browser = typeof args.browser === "string" ? args.browser : undefined;
        const profile = typeof args.profile === "string" ? args.profile : undefined;
        const browserReady = await ensureMcpBrowserReady(orchestrator, {
          browser,
          profile,
          ...(options?.workDir ? { workDir: options.workDir } : {}),
          ...(options?.discoverProfiles ? { discoverProfiles: options.discoverProfiles } : {}),
        });
        if (!browserReady.ok) {
          return { text: browserReady.errorText ?? "Browser is not ready.", isError: true };
        }
        const prompt = typeof args.prompt === "string" ? args.prompt : String(args.prompt ?? "");
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
          prompt, platform, targetId, writeFiles, outDir, newChat, openTab,
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

      case "convo_compare": {
        const browser = typeof args.browser === "string" ? args.browser : undefined;
        const profile = typeof args.profile === "string" ? args.profile : undefined;
        const browserReady = await ensureMcpBrowserReady(orchestrator, {
          browser,
          profile,
          ...(options?.workDir ? { workDir: options.workDir } : {}),
          ...(options?.discoverProfiles ? { discoverProfiles: options.discoverProfiles } : {}),
        });
        if (!browserReady.ok) {
          return { text: browserReady.errorText ?? "Browser is not ready.", isError: true };
        }
        const prompt = typeof args.prompt === "string" ? args.prompt : String(args.prompt ?? "");
        const platforms = Array.isArray(args.platforms) ? (args.platforms as PlatformId[]) : undefined;
        const arbitrate = typeof args.arbitrate === "boolean" ? args.arbitrate : undefined;
        const arbiter = typeof args.arbiter === "string" ? (args.arbiter as PlatformId) : undefined;
        const threads = threadsFrom(args.threads);
        const report = await orchestrator.compare({
          prompt, platforms, arbitrate, arbiter,
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

      case "convo_status": {
        const resolution = await loadResolution(undefined, options?.workDir);
        if (!resolution.ok) {
          return {
            text: JSON.stringify({ ok: false, error: resolution.error }),
            isError: true,
          };
        }
        return {
          text: JSON.stringify({ ok: true, setup: resolution.value }),
          structured: { ok: true, setup: resolution.value },
        };
      }

      case "convo_setup": {
        const browser = typeof args.browser === "string" ? (args.browser as BrowserId) : undefined;
        if (!browser) {
          // A setup call without a browser is the agent asking "what can I pick?".
          // Answering with the choice set is what stops it from hand-editing
          // .convo/config.json to guess.
          const discover = options?.discoverProfiles ?? (() => new BrowserDiscoveryService().discoverProfiles());
          const profiles: DiscoveredProfile[] = await discover().catch(() => []);
          if (profiles.length === 0) {
            return {
              text: "Error: 'browser' is required. Call convo_setup with { browser: 'firefox', profile: '<path>' }.",
              isError: true,
            };
          }
          const choices = profiles.map((profile) => `${profile.name}${profile.email ? ` <${profile.email}>` : ""} (${profile.browser})`);

          const chosen = await askForProfile(options?.elicitation, choices);
          const picked = chosen === undefined ? undefined : profiles[choices.indexOf(chosen)];
          if (picked) {
            const outcome = await (options?.applySetupFn ?? applySetup)({
              browserId: picked.browser as BrowserId,
              profilePath: picked.userDataDir,
              ...(typeof args.transport === "string" ? { transport: args.transport as TransportId } : {}),
              verifyTab: args.verifyTab === true,
              ...(options?.workDir ? { workDir: options.workDir } : {}),
            });
            const structured = { ok: true, config: outcome.config, warning: outcome.warning ?? null, answeredBy: "elicitation" };
            return { text: JSON.stringify(structured), structured };
          }

          const structured = {
            ok: false,
            requiresUserSelection: true,
            question: "Which browser profile should ConvoLink drive for this project?",
            options: choices,
            nextTool: "convo_profile",
          };
          return {
            text: [
              "No browser was given, and a profile is a human decision.",
              "",
              "Options:",
              ...choices.map((choice, index) => `  ${index + 1}) ${choice}`),
              "",
              "Ask the user, then persist the answer with: convo_profile({ action: 'select', target: '<index|email|path>' })",
            ].join("\n"),
            isError: true,
            structured,
          };
        }
        const outcome = await applySetup({
          browserId: browser,
          ...(typeof args.profile === "string" ? { profilePath: args.profile } : {}),
          ...(typeof args.transport === "string" ? { transport: args.transport as TransportId } : {}),
          verifyTab: args.verifyTab === true,
          ...(options?.workDir ? { workDir: options.workDir } : {}),
        });
        const structured = { ok: true, config: outcome.config, warning: outcome.warning ?? null };
        return { text: JSON.stringify(structured), structured };
      }

      case "convo_onboard": {
        const report = buildOnboardReport(await (options?.collectOnboardFacts ?? collectOnboardFacts)());
        return { text: JSON.stringify(report), structured: { ...report } };
      }

      case "convo_doctor": {
        const fix = args.fix === true;
        const fixResult = fix ? await runSelfHealingClean() : undefined;
        const report = await orchestrator.doctor();
        const resolution = await loadResolution(undefined, options?.workDir);
        const capabilities = await buildCapabilities({
          resolution: resolution.ok ? resolution.value : null,
          transportOk: report.transportHealth.ok,
          ...(report.transportHealth.error ? { transportError: report.transportHealth.error } : {}),
        });
        const structured = {
          ok: report.transportHealth.ok,
          configured: resolution.ok ? resolution.value : null,
          capabilities,
          transportHealth: report.transportHealth,
          tabs: report.tabs,
          ...(fixResult ? { fixResult } : {}),
        };
        return { text: JSON.stringify(structured), structured };
      }

      case "convo_list_tabs": {
        const tabs = await orchestrator.listTabs();
        const structured = {
          tabs: tabs.map((tab) => ({
            targetId: tab.targetId,
            platform: tab.platformId,
            title: tab.title,
            url: tab.url,
            threadId: tab.threadId,
            managed: isManagedTabRef(tab),
          })),
        };
        const text = tabs
          .map((tab) => `• [${tab.platformId ?? "OTHER"}] ${tab.title} (Target: ${tab.targetId}, URL: ${tab.url}${tab.threadId ? `, thread: ${tab.threadId}` : ""})`)
          .join("\n");
        return { text: text || "No open tabs found. Call convo_tab({ action: 'new', target: 'deepseek' }) to open one.", structured };
      }

      case "convo_tab": {
        const action = typeof args.action === "string" ? args.action : "";
        if (action === "new") {
          const target = typeof args.target === "string" && args.target.trim() ? args.target.trim() : "chatgpt";
          const tab = await orchestrator.createTab(target);
          return { text: `Spawned tab [${tab.targetId}] for ${tab.url}` };
        }
        if (action === "close") {
          const targetId = typeof args.targetId === "string" ? args.targetId.trim() : "";
          if (!targetId) return { text: "Error: targetId is required for action 'close'. Call convo_list_tabs to view active tab IDs.", isError: true };
          await orchestrator.closeTab(targetId);
          return { text: `Closed tab [${targetId}]` };
        }
        if (action === "back") {
          const targetId = typeof args.targetId === "string" ? args.targetId.trim() : undefined;
          await orchestrator.goBack(targetId);
          return { text: "Navigated active tab back in browser history." };
        }
        if (action === "undo") {
          const targetId = typeof args.targetId === "string" ? args.targetId.trim() : undefined;
          const res = await orchestrator.undo(targetId);
          return { text: res ? `Restored previous conversation URL: ${res.restoredUrl}` : "No previous checkpoint found to restore." };
        }
        return { text: `Error: Invalid action '${action}'. Valid actions: 'new', 'close', 'back', 'undo'.`, isError: true };
      }

      case "convo_search": {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        const limit = typeof args.limit === "number" ? args.limit : 10;
        const results = await orchestrator.searchLedger(query, limit);
        if (results.length === 0) return { text: `No results matching "${query}".` };
        const text = results.map((r) => `• [Thread ${r.threadId}] Turn ${r.turnIndex} (${r.role}):\n  ${r.snippet}`).join("\n\n");
        return { text };
      }

      case "convo_thread": {
        const action = typeof args.action === "string" ? args.action : "";
        if (action === "export") {
          const threadId = typeof args.threadId === "string" ? args.threadId.trim() : "";
          if (!threadId) return { text: "Error: threadId is required for action 'export'. Call convo_search to find historical thread IDs.", isError: true };
          const format = args.format === "json" ? "json" : "markdown";
          const output = await orchestrator.exportThread(threadId, format);
          return { text: output };
        }
        if (action === "resume") {
          const threadId = typeof args.threadId === "string" ? args.threadId.trim() : "";
          if (!threadId) return { text: "Error: threadId is required for action 'resume'. Call convo_search to find historical thread IDs.", isError: true };
          const tab = await orchestrator.resumeThread(threadId);
          return { text: `Reopened saved thread [${threadId}] in tab [${tab.targetId}]: ${tab.url}` };
        }
        if (action === "history") {
          const targetId = typeof args.targetId === "string" ? args.targetId.trim() : undefined;
          const history = await orchestrator.getHistory(targetId);
          if (!history || history.length === 0) return { text: "No session history recorded for this tab yet." };
          const lines = history.map((h, i) => `  ${i + 1}. [${h.timestamp}] ${h.url}`);
          return { text: `Session Checkpoints:\n${lines.join("\n")}` };
        }
        return { text: `Error: Invalid action '${action}'. Valid actions: 'export', 'resume', 'history'.`, isError: true };
      }

      case "convo_profile": {
        const action = typeof args.action === "string" ? args.action : "list";
        if (action === "select") {
          const target = typeof args.target === "string" ? args.target : "";
          return selectProfile(target, options?.workDir);
        }
        return { text: await getProfilesListText(options?.workDir) };
      }

      default:
        return { text: `Unknown tool: ${name}. Call tools/list to inspect valid tools.`, isError: true };
    }
  } catch (err: unknown) {
    const error = toConvoError(err);
    return { text: JSON.stringify({ ok: false, error: error.toJSON() }), isError: true };
  }
}

/**
 * Asks the human to pick a profile. Returns undefined when the client cannot
 * ask, declines, or cancels — the caller then falls back to the text choice set.
 */
async function askForProfile(port: ElicitationPort | undefined, choices: readonly string[]): Promise<string | undefined> {
  if (!port?.supported) return undefined;
  const answer = await port.request({
    message: "Which browser profile should ConvoLink drive for this project?",
    requestedSchema: {
      type: "object",
      properties: {
        profile: { type: "string", title: "Browser profile", enum: [...choices] },
      },
      required: ["profile"],
    },
  });
  if (answer.action !== "accept") return undefined;
  const value = answer.content?.profile;
  return typeof value === "string" && choices.includes(value) ? value : undefined;
}
