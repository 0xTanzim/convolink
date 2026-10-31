/**
 * StreamSettlingDetector enforces 3-signal streaming completion per AGENTS.md §4.5:
 * 1. Action container state (stop button / loading spinner absent).
 * 2. Thinking container transition (thought block closed / static).
 * 3. Quiescence window: content length must remain stable for at least quiescenceMs (default 400ms).
 */

export interface SettlingOptions {
  readonly isGenerating: boolean;
  readonly isThinking?: boolean;
  readonly contentLength: number;
  readonly quiescenceMs?: number; // default 400ms
}

export class StreamSettlingDetector {
  public static readonly DEFAULT_QUIESCENCE_MS = 400;

  private lastContentLength: number = -1;
  private stableSince: number | null = null;
  private readonly defaultQuiescenceMs: number;

  public constructor(defaultQuiescenceMs: number = StreamSettlingDetector.DEFAULT_QUIESCENCE_MS) {
    this.defaultQuiescenceMs = defaultQuiescenceMs;
  }

  /**
   * Resets internal tracking state. Call before awaiting a new turn or stream.
   */
  public reset(): void {
    this.lastContentLength = -1;
    this.stableSince = null;
  }

  /**
   * Evaluates if the current state satisfies all three completion signals.
   *
   * @param options Settling metrics sampled from the active DOM
   * @param now Optional timestamp in ms (defaults to Date.now()) for deterministic testing
   * @returns true if settled for >= quiescenceMs, false otherwise
   */
  public isSettled(options: SettlingOptions, now: number = Date.now()): boolean {
    const { isGenerating, isThinking = false, contentLength, quiescenceMs = this.defaultQuiescenceMs } = options;

    // Signal 1 & 2: Generation active, thinking active, or no output -> cannot be settled
    if (isGenerating || isThinking || contentLength <= 0) {
      this.lastContentLength = contentLength;
      this.stableSince = null;
      return false;
    }

    // Signal 3: Content length change resets stability timer
    if (contentLength !== this.lastContentLength) {
      this.lastContentLength = contentLength;
      this.stableSince = now;
      return false;
    }

    // First stable sample at this content length
    if (this.stableSince === null) {
      this.stableSince = now;
      return false;
    }

    // Check if stable duration satisfies the required quiescence window
    return now - this.stableSince >= quiescenceMs;
  }

  /**
   * Returns current continuous stable duration in milliseconds, or 0.
   */
  public getStableDurationMs(now: number = Date.now()): number {
    return this.stableSince !== null ? Math.max(0, now - this.stableSince) : 0;
  }
}
