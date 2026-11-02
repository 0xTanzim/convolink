import { ConvoError, toConvoError } from "../core/errors/convo-error.js";

export function hasJsonFlag(args: readonly string[]): boolean {
  return args.includes("--json") || args.includes("-j");
}

export interface Envelope<T> {
  readonly ok: boolean;
  readonly command: string;
  readonly data: T | null;
  readonly error: ReturnType<ConvoError["toJSON"]> | null;
}

export function successEnvelope<T>(command: string, data: T): Envelope<T> {
  return { ok: true, command, data, error: null };
}

export function failureEnvelope(command: string, error: unknown): Envelope<never> {
  return { ok: false, command, data: null, error: toConvoError(error).toJSON() };
}

/**
 * Human form: one line of what failed, one line of what to run. Stack traces are
 * diagnostic noise for a caller, so they stay behind an env switch.
 */
export function printError(error: unknown): number {
  const convo = toConvoError(error);
  console.error(`❌ ${convo.message}`);
  console.error(`   → ${convo.remediation}`);
  if (process.env.CONVOLINK_DEBUG === "1" && convo.cause instanceof Error && convo.cause.stack) {
    console.error(convo.cause.stack);
  }
  return convo.exitCode;
}

export function printJson(document: unknown): void {
  console.log(JSON.stringify(document, null, 2));
}
