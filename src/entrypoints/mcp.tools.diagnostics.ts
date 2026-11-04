import type { SessionOrchestrator } from "../core/services/orchestrator.js";
import { loadResolution } from "./config-context.js";
import { BrowserDiscoveryService, type DiscoveredProfile } from "../adapters/browsers/browser-discovery.js";
import type { ElicitationPort } from "./mcp.elicitation.js";
import { buildOnboardReport } from "../core/services/onboarding.service.js";
import { collectOnboardFacts } from "./onboard.facts.js";
import { buildCapabilities } from "./cli.doctor.js";
import { applySetup } from "./cli.setup.js";
import type { BrowserId, TransportId } from "../core/ports/config.port.js";
import { runSelfHealingClean, getProfilesListText, selectProfile } from "./mcp.helpers.js";
import type { ExecuteToolOptions, McpToolExecutionResult } from "./mcp.tools.types.js";

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

export async function handleStatus(workDir?: string): Promise<McpToolExecutionResult> {
  const resolution = await loadResolution(undefined, workDir);
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

export async function handleSetup(
  args: Record<string, unknown>,
  workDir?: string,
  options?: ExecuteToolOptions,
): Promise<McpToolExecutionResult> {
  const browser = typeof args.browser === "string" ? (args.browser as BrowserId) : undefined;
  if (!browser) {
    const discover = options?.discoverProfiles ?? (() => new BrowserDiscoveryService().discoverProfiles());
    const profiles: DiscoveredProfile[] = await discover().catch(() => []);
    if (profiles.length === 0) {
      return {
        text: "Error: 'browser' is required. Call convo_setup with { browser: 'firefox', profile: '<path>' }.",
        isError: true,
      };
    }
    const choices = profiles.map((p) => `${p.name}${p.email ? ` <${p.email}>` : ""} (${p.browser})`);
    const chosen = await askForProfile(options?.elicitation, choices);
    const picked = chosen === undefined ? undefined : profiles[choices.indexOf(chosen)];
    if (picked) {
      const outcome = await (options?.applySetupFn ?? applySetup)({
        browserId: picked.browser as BrowserId,
        profilePath: picked.userDataDir,
        ...(typeof args.transport === "string" ? { transport: args.transport as TransportId } : {}),
        verifyTab: args.verifyTab === true,
        ...(workDir ? { workDir } : {}),
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
    ...(workDir ? { workDir } : {}),
  });
  const structured = { ok: true, config: outcome.config, warning: outcome.warning ?? null };
  return { text: JSON.stringify(structured), structured };
}

export async function handleOnboard(options?: ExecuteToolOptions): Promise<McpToolExecutionResult> {
  const report = buildOnboardReport(await (options?.collectOnboardFacts ?? collectOnboardFacts)());
  return { text: JSON.stringify(report), structured: { ...report } };
}

export async function handleDoctor(
  orchestrator: SessionOrchestrator,
  args: Record<string, unknown>,
  workDir?: string,
): Promise<McpToolExecutionResult> {
  const fix = args.fix === true;
  const fixResult = fix ? await runSelfHealingClean() : undefined;
  const report = await orchestrator.doctor();
  const resolution = await loadResolution(undefined, workDir);
  const capabilities = await buildCapabilities({
    resolution: resolution.ok ? resolution.value : null,
    transportOk: report.transportHealth.ok,
    ...(report.transportHealth.error ? { transportError: report.transportHealth.error } : {}),
  });
  const supportedTabs = (report.tabs ?? []).filter((tab) => Boolean(tab.platformId ?? (tab as any).platform));
  const structured = {
    ok: report.transportHealth.ok,
    configured: resolution.ok ? resolution.value : null,
    capabilities,
    transportHealth: report.transportHealth,
    tabs: supportedTabs,
    ...(fixResult ? { fixResult } : {}),
  };
  return { text: JSON.stringify(structured), structured };
}

export async function handleProfile(args: Record<string, unknown>, workDir?: string): Promise<McpToolExecutionResult> {
  const action = typeof args.action === "string" ? args.action : "list";
  if (action === "select") {
    const target = typeof args.target === "string" ? args.target : "";
    return selectProfile(target, workDir);
  }
  return { text: await getProfilesListText(workDir) };
}
