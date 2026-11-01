export interface IdleTimeoutOptions {
  readonly timeoutMs: number;
  readonly onTimeout: () => void | Promise<void>;
}

export function parseDurationMs(durationStr: string): number {
  const trimmed = durationStr.trim();
  if (!trimmed) {
    throw new Error("Duration string cannot be empty");
  }
  const match = trimmed.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i);
  if (!match) {
    throw new Error(`Invalid duration format: "${durationStr}". Expected format like "15m", "30s", "100ms", "1h", or "0".`);
  }
  const value = parseFloat(match[1]!);
  const unit = (match[2] ?? "ms").toLowerCase();
  switch (unit) {
    case "ms":
      return Math.round(value);
    case "s":
      return Math.round(value * 1000);
    case "m":
      return Math.round(value * 60 * 1000);
    case "h":
      return Math.round(value * 60 * 60 * 1000);
    case "d":
      return Math.round(value * 24 * 60 * 60 * 1000);
    default:
      return Math.round(value);
  }
}

export class IdleTimeoutController {
  private timer: NodeJS.Timeout | null = null;
  private readonly timeoutMs: number;
  private readonly onTimeout: () => void | Promise<void>;
  private stopped = false;

  public constructor(
    optionsOrTimeout: IdleTimeoutOptions | number,
    onTimeoutCallback?: () => void | Promise<void>,
  ) {
    if (typeof optionsOrTimeout === "number") {
      this.timeoutMs = optionsOrTimeout;
      this.onTimeout = onTimeoutCallback ?? (() => {});
    } else {
      this.timeoutMs = optionsOrTimeout.timeoutMs;
      this.onTimeout = optionsOrTimeout.onTimeout;
    }
    this.arm();
  }

  public recordActivity(): void {
    if (this.stopped || this.timeoutMs <= 0) return;
    this.arm();
  }

  public stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private arm(): void {
    if (this.stopped || this.timeoutMs <= 0) return;
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      void this.onTimeout();
    }, this.timeoutMs);
  }
}

export interface TeardownOptions {
  readonly exitOnSignal?: boolean;
}

export function registerTeardownHandlers(
  onCleanup: () => void | Promise<void>,
  options: TeardownOptions = {},
): () => void {
  let cleanedUp = false;
  const runCleanup = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    try {
      await onCleanup();
    } catch {}
  };

  const handleSignal = async () => {
    await runCleanup();
    if (options.exitOnSignal !== false) {
      process.exit(0);
    }
  };

  const sigListener = () => { void handleSignal(); };
  process.on("SIGINT", sigListener);
  process.on("SIGTERM", sigListener);
  process.once("exit", runCleanup);
  process.on("disconnect", sigListener);

  return () => {
    process.off("SIGINT", sigListener);
    process.off("SIGTERM", sigListener);
    process.off("exit", runCleanup);
    process.off("disconnect", sigListener);
  };
}

