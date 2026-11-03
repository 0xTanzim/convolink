import { ConvoError } from "../../core/errors/convo-error.js";

export interface TranslatedOperation {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface SelectorContract {
  readonly composer?: string;
  readonly send?: string;
}

export interface ToggleContract extends Record<string, unknown> {
  readonly selector: string;
  readonly selectedClass: string;
  readonly toggles: Record<string, { label: string; selected: boolean }>;
}

export function allQuoted(expression: string): string[] {
  const matches = expression.match(/"(?:[^"\\]|\\.)*"/g) ?? [];
  return matches.flatMap((value) => {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? [parsed] : [];
    } catch {
      return [];
    }
  });
}

export function firstQuoted(expression: string): string | null {
  return allQuoted(expression)[0] ?? null;
}

export function lastQuoted(expression: string, offsetFromEnd = 0): string | null {
  const quoted = allQuoted(expression);
  return quoted[quoted.length - 1 - offsetFromEnd] ?? null;
}

export function toggleContract(expression: string): ToggleContract | null {
  const match = expression.match(/\/\*\s*convolink:toggles\s+(\{[\s\S]*?\})\s*\*\//);
  if (!match || !match[1]) return null;
  try {
    const parsed = JSON.parse(match[1]) as ToggleContract;
    return parsed.selector && parsed.selectedClass && parsed.toggles ? parsed : null;
  } catch {
    return null;
  }
}

export function selectorContract(expression: string): SelectorContract | null {
  const match = expression.match(/\/\*\s*convolink:selectors\s+(\{[\s\S]*?\})\s*\*\//);
  if (!match || !match[1]) return null;
  try {
    return JSON.parse(match[1]) as SelectorContract;
  } catch {
    return null;
  }
}

export function translateExpression(_targetId: string, expression: string): TranslatedOperation {
  if (expression === "location.href") return { type: "GET_URL", payload: {} };
  if (expression.includes("/* getLastText */")) {
    return { type: "GET_LAST_TEXT", payload: { selector: firstQuoted(expression) ?? "" } };
  }
  if (expression.includes("/* getText */")) return { type: "GET_TEXT", payload: { selector: firstQuoted(expression) ?? "" } };
  if (expression.includes("location.reload")) return { type: "RELOAD", payload: {} };
  if (expression.includes("findContinuationTrigger")) return { type: "PROBE_CONTINUATION", payload: {} };
  if (expression.includes("findDownloadLinks")) return { type: "PROBE_DOWNLOADS", payload: {} };
  if (expression.includes("inspectCanvas")) return { type: "INSPECT_CANVAS", payload: {} };
  if (expression.includes("startNewChat")) return { type: "START_NEW_CHAT", payload: { baseUrl: firstQuoted(expression) ?? "" } };
  if (expression.includes("send.click()")) return { type: "CLICK", payload: { selector: lastQuoted(expression) ?? "" } };
  if (expression.includes("c.focus()")) return { type: "FOCUS", payload: { selector: lastQuoted(expression) ?? "" } };
  if (expression.includes("querySelectorAll(\"*\")") || expression.includes("querySelectorAll('*')")) {
    return { type: "PROBE_QUIET", payload: {} };
  }
  if (expression.includes("/* readThread */")) return { type: "READ_THREAD", payload: { lastN: 20 } };
  if (expression.includes("/* resolveSelectors */")) return { type: "PROBE_SELECTORS", payload: {} };
  if (expression.includes("/* awaitCompletion */") || expression.includes("assistantText")) {
    return { type: "PROBE_STATUS", payload: { beforeTurnCount: 0 } };
  }
  if (expression.includes("document.body.innerText")) {
    return { type: "GET_BODY_INCLUDES", payload: { text: allQuoted(expression).filter(Boolean).pop() ?? "" } };
  }
  if (expression.includes("/* triggerContinuation */")) return { type: "TRIGGER_CONTINUATION", payload: {} };
  if (expression.includes("/* findContinuationTrigger */")) return { type: "PROBE_CONTINUATION", payload: {} };

  if (expression.includes("/* authCheck */")) {
    const composer = selectorContract(expression)?.composer;
    if (!composer) {
      throw new ConvoError(
        "extension-unsupported",
        "The auth check probe carries no composer selector",
        "Add the composer selector to the probe or use a transport that evaluates it directly.",
      );
    }
    return { type: "PROBE_MOUNTED", payload: { composer } };
  }

  const toggles = toggleContract(expression);
  if (toggles) return { type: "APPLY_TOGGLES", payload: { ...toggles } };

  const contract = selectorContract(expression);
  const requireContract = (label: string): SelectorContract => {
    if (!contract || !contract.composer) {
      throw new ConvoError(
        "extension-unsupported",
        `${label} probe is missing its convolink:selectors contract`,
        "Rebuild the host or use a transport that evaluates the probe directly.",
      );
    }
    return contract;
  };

  if (expression.includes("c.value || c.innerText")) {
    const selected = requireContract("Composer-text");
    return { type: "PROBE_COMPOSER_TEXT", payload: { selector: selected.composer } };
  }
  if (expression.includes("aria-disabled")) {
    const selected = requireContract("Ready");
    if (!selected.send) {
      throw new ConvoError(
        "extension-unsupported",
        "Ready probe is missing its send selector contract",
        "Rebuild the host or use a transport that evaluates the probe directly.",
      );
    }
    return { type: "PROBE_READY", payload: { composer: selected.composer, send: selected.send } };
  }
  if (expression.includes("document.readyState") && expression.includes("querySelector")) {
    const selected = requireContract("Mounted");
    return { type: "PROBE_MOUNTED", payload: { composer: selected.composer } };
  }
  if (process.env.CONVOLINK_DEBUG === "1") process.stderr.write(`[unmapped] ${expression.slice(0, 400)}\n`);
  throw new ConvoError(
    "extension-unsupported",
    `The extension transport cannot evaluate arbitrary JavaScript (MV3 CSP): ${expression.slice(0, 80)}`,
    "Use a CDP/Firefox transport for this platform, or add an operation for this probe.",
  );
}
