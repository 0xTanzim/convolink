import type { TransportId } from "../ports/config.port.js";

export interface OnboardProfileOption {
  readonly browser: string;
  readonly profileId: string;
  readonly name: string;
  readonly email: string;
  readonly userDataDir: string;
}

export interface OnboardFacts {
  readonly transport: TransportId;
  readonly port: number;
  readonly daemon: { readonly running: boolean; readonly endpoint: string };
  readonly extension: {
    readonly connected: boolean;
    readonly clients: number;
    readonly buildMismatch: string | null;
    readonly unpackedPath: string | null;
    readonly pairingToken: string;
  };
  readonly profiles: readonly OnboardProfileOption[];
  readonly config: { readonly browser: string; readonly profilePath: string | null; readonly transport: string; readonly port: number } | null;
  readonly transportHealthy: boolean;
}

export type OnboardStepId = "daemon" | "extension" | "profile" | "transport";

export interface OnboardAction {
  readonly kind: "command" | "user" | "tool";
  readonly command?: string;
  readonly tool?: string;
  readonly args?: Record<string, unknown>;
  readonly instruction?: string;
  readonly why: string;
}

export interface OnboardStep {
  readonly id: OnboardStepId;
  readonly status: "done" | "todo" | "blocked";
  readonly summary: string;
  readonly action?: OnboardAction;
}

export interface OnboardChoice {
  readonly question: string;
  readonly options: readonly string[];
}

export interface OnboardReport {
  readonly ok: boolean;
  readonly transport: TransportId;
  readonly port: number;
  readonly steps: readonly OnboardStep[];
  readonly nextAction: OnboardAction | null;
  readonly requiresUserSelection: OnboardChoice | null;
  readonly warnings: readonly string[];
}

const PROFILE_QUESTION = "Which browser profile should ConvoLink drive for this project?";

function profileLabel(profile: OnboardProfileOption): string {
  const owner = profile.email ? ` <${profile.email}>` : "";
  return `${profile.name}${owner} (${profile.browser})`;
}

function pairingInstruction(facts: OnboardFacts): string {
  const load = facts.extension.unpackedPath
    ? `  Folder: ${facts.extension.unpackedPath}`
    : "  Get it: https://github.com/0xTanzim/convolink/releases/latest — download the Companion zip, unzip it, and load that folder (this install ships no unpacked bundle).";
  return [
    "Open chrome://extensions, enable Developer mode, Load unpacked,",
    "open the ConvoLink Companion popup, paste the pairing token, then click Save Settings & Connect.",
    load,
    `  Token:  ${facts.extension.pairingToken}`,
  ].join("\n");
}

export function buildOnboardReport(facts: OnboardFacts): OnboardReport {
  const steps: OnboardStep[] = [];
  const warnings: string[] = [];
  const usesBridge = facts.transport === "extension-bridge";

  if (usesBridge) {
    steps.push(
      facts.daemon.running
        ? { id: "daemon", status: "done", summary: `Daemon answering at ${facts.daemon.endpoint}` }
        : {
            id: "daemon",
            status: "todo",
            summary: "Bridge daemon is not running, so nothing can reach port 9224.",
            action: { kind: "command", command: "convo daemon start", why: "The daemon owns port 9224; without it every browser call fails." },
          },
    );

    if (facts.extension.connected) {
      steps.push({ id: "extension", status: "done", summary: `${facts.extension.clients} extension client(s) connected` });
    } else {
      steps.push({
        id: "extension",
        status: "todo",
        summary: "No companion extension has connected to the bridge.",
        action: {
          kind: "user",
          instruction: pairingInstruction(facts),
          why: "Only a human can load the unpacked extension and paste the token.",
        },
      });
    }

    if (facts.extension.connected && facts.extension.buildMismatch) {
      warnings.push(facts.extension.buildMismatch);
    }
  }

  if (facts.config) {
    steps.push({ id: "profile", status: "done", summary: `Project profile: ${facts.config.browser} (${facts.config.profilePath ?? "default"})` });
  } else {
    steps.push({
      id: "profile",
      status: "todo",
      summary: "No .convo/config.json for this project yet.",
      action: {
        kind: "user",
        instruction: "The user must pick a profile before ConvoLink writes .convo/config.json.",
        why: "Choosing a profile silently is how a project ends up driving the wrong session.",
      },
    });
  }

  steps.push(
    facts.transportHealthy
      ? { id: "transport", status: "done", summary: `${facts.transport} is healthy` }
      : {
          id: "transport",
          status: "blocked",
          summary: `${facts.transport} is not answering.`,
          action: { kind: "command", command: "convo doctor", why: "Doctor names the exact fault and the remediation for it." },
        },
  );

  const requiresUserSelection: OnboardChoice | null =
    facts.config || facts.profiles.length === 0
      ? null
      : { question: PROFILE_QUESTION, options: facts.profiles.map(profileLabel) };

  const next = steps.find((step) => step.status !== "done");
  return {
    ok: next === undefined,
    transport: facts.transport,
    port: facts.port,
    steps,
    nextAction: next?.action ?? null,
    requiresUserSelection,
    warnings,
  };
}
