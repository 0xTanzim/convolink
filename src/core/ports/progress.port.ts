export type QueryStage = "prepare" | "filling" | "submitted" | "generating" | "done" | "failed";

export interface ProgressEvent {
  readonly stage: QueryStage;
  readonly platform?: string;
  readonly elapsedMs: number;
  readonly detail?: string;
}

export interface ProgressPort {
  report(event: ProgressEvent): void;
}

export function elapsedReporter(startedAt = Date.now()): (stage: QueryStage, platform?: string, detail?: string) => void {
  return (stage, platform, detail) => {
    const event: ProgressEvent = {
      stage,
      elapsedMs: Date.now() - startedAt,
      ...(platform ? { platform } : {}),
      ...(detail ? { detail } : {}),
    };
    process.stderr.write(`${JSON.stringify({ type: "progress", ...event })}\n`);
  };
}
