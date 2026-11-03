import { buildOnboardReport, type OnboardFacts, type OnboardReport } from "../core/services/onboarding.service.js";
import { hasJsonFlag, printJson, successEnvelope } from "./cli.output.js";
import { collectOnboardFacts } from "./onboard.facts.js";

export interface OnboardDeps {
  readonly collectFacts?: () => Promise<OnboardFacts>;
}

function exitCodeFor(report: OnboardReport): number {
  if (report.ok) return 0;
  // A command we can run ourselves is a transport problem (3); a human step is 4.
  return report.nextAction?.kind === "command" ? 3 : 4;
}

function printHuman(report: OnboardReport): void {
  console.log(report.ok ? "✅ ConvoLink is ready for this project." : "⚠️  ConvoLink is not ready yet.");
  for (const step of report.steps) {
    const marker = step.status === "done" ? "✅" : step.status === "todo" ? "⏳" : "⛔";
    console.log(`  ${marker} ${step.id.padEnd(9)} ${step.summary}`);
  }
  for (const warning of report.warnings) console.log(`\n  ⚠️  ${warning}`);

  if (report.nextAction?.kind === "command") console.log(`\n  → Next: ${report.nextAction.command}\n     ${report.nextAction.why}`);
  if (report.nextAction?.kind === "user") console.log(`\n  → Next: ${report.nextAction.instruction}`);

  if (report.requiresUserSelection) {
    console.log(`\n  ${report.requiresUserSelection.question}`);
    report.requiresUserSelection.options.forEach((option, index) => console.log(`    ${index + 1}) ${option}`));
    console.log("    Pick one with: convo profile select <index|email>");
  }
}

export async function handleOnboard(args: string[], deps: OnboardDeps = {}): Promise<number> {
  const report = buildOnboardReport(await (deps.collectFacts ?? collectOnboardFacts)());
  const json = hasJsonFlag(args);

  if (json) {
    // Top-level ok mirrors readiness, not "the query ran": an agent branches on
    // it before it reads the steps.
    if (report.ok) printJson(successEnvelope("onboard", report));
    else
      printJson({
        ok: false,
        command: "onboard",
        data: report,
        error: {
          code: "not-ready",
          message: report.steps.find((step) => step.status !== "done")?.summary ?? "ConvoLink is not ready.",
          remediation: report.nextAction?.command ?? report.nextAction?.instruction ?? "Run `convo doctor`.",
          retryable: false,
        },
      });
  } else printHuman(report);

  return exitCodeFor(report);
}
