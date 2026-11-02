import { ProjectConfigAdapter } from "../adapters/config/project-config.adapter.js";
import { ConvoError } from "../core/errors/convo-error.js";
import type { BrowserId, TransportId } from "../core/ports/config.port.js";
import { requireResolution } from "./config-context.js";
import { applySetup, type SetupInput } from "./cli.setup.js";
import { failureEnvelope, hasJsonFlag, printError, printJson, successEnvelope } from "./cli.output.js";

interface SetupFlags {
  readonly show: boolean;
  readonly reset: boolean;
  readonly json: boolean;
  readonly input: SetupInput;
}

function parseFlags(args: readonly string[]): SetupFlags {
  const browserId = valueOf(args, "--browser") ?? valueOf(args, "-b");
  return {
    show: args.includes("--show"),
    reset: args.includes("--reset"),
    json: hasJsonFlag(args),
    input: {
      ...(browserId ? { browserId: browserId as BrowserId } : {}),
      ...(valueOf(args, "--profile") ? { profilePath: valueOf(args, "--profile")! } : {}),
      ...(valueOf(args, "--transport") ? { transport: valueOf(args, "--transport") as TransportId } : {}),
      verifyTab: !args.includes("--no-verify-tab"),
    },
  };
}

function valueOf(args: readonly string[], flag: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index !== -1 ? args[index + 1] : undefined;
}

export async function handleSetup(args: string[]): Promise<number> {
  const flags = parseFlags(args);

  if (flags.reset) {
    await new ProjectConfigAdapter().remove();
    if (flags.json) printJson(successEnvelope("setup", { reset: true }));
    else console.log("🧹 Removed .convo/config.json — the next browser command will run setup.");
    return 0;
  }

  if (flags.show) return showSetup(flags.json);

  try {
    const outcome = await applySetup(flags.input);
    if (flags.json) {
      printJson(successEnvelope("setup", {
        browser: outcome.config.browserId,
        profilePath: outcome.config.profilePath ?? null,
        transport: outcome.config.transport,
        port: outcome.config.port,
        warning: outcome.warning ?? null,
      }));
    } else {
      console.log(`✅ Setup saved to .convo/config.json`);
      console.log(`   Browser: ${outcome.config.browserId}`);
      console.log(`   Profile: ${outcome.config.profilePath ?? "(none)"}`);
      console.log(`   Transport: ${outcome.config.transport} on port ${outcome.config.port}`);
      if (outcome.warning) console.log(`   ⚠️  ${outcome.warning}`);
      console.log(`\nNext: convo ask -p deepseek "hello"`);
    }
    return 0;
  } catch (error) {
    if (flags.json) printJson(failureEnvelope("setup", error));
    return printError(error);
  }
}

async function showSetup(json: boolean): Promise<number> {
  const result = await (async () => {
    try {
      return { ok: true as const, value: requireResolution(await import("./config-context.js").then((m) => m.loadResolution())) };
    } catch (error) {
      return { ok: false as const, error };
    }
  })();

  if (!result.ok) {
    if (json) printJson(failureEnvelope("setup", result.error));
    return printError(result.error instanceof ConvoError ? result.error : new ConvoError(
      "configuration-required",
      "No browser is configured for this project.",
      "Run `convo setup` to choose the browser and profile ConvoLink should drive.",
    ));
  }

  const value = result.value;
  if (json) {
    printJson(successEnvelope("setup", value));
    return 0;
  }

  console.log("Current ConvoLink setup:");
  console.log(`  browser   ${value.browserId} (${value.sources.browserId})`);
  console.log(`  profile   ${value.profilePath ?? "(browser default)"} (${value.sources.profilePath})`);
  console.log(`  transport ${value.transport} (${value.sources.transport})`);
  console.log(`  endpoint  ${value.endpoint} (${value.sources.port})`);
  return 0;
}
