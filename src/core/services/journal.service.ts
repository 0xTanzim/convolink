export interface SessionCheckpoint {
  readonly id: string;
  readonly timestamp: string;
  readonly targetId: string;
  readonly platformId?: string | null;
  readonly url: string;
  readonly threadId?: string | null;
  readonly action: "new_chat" | "navigate" | "open_tab" | "ask" | "rollover";
}

export type NewCheckpointParams = Omit<SessionCheckpoint, "id" | "timestamp">;

export class StateJournalService {
  private readonly maxEntries: number;
  private readonly checkpoints: SessionCheckpoint[] = [];
  private counter = 0;

  public constructor(maxEntries = 50) {
    this.maxEntries = maxEntries;
  }

  public record(params: NewCheckpointParams): SessionCheckpoint {
    const checkpoint: SessionCheckpoint = {
      ...params,
      id: `chk-${Date.now()}-${++this.counter}`,
      timestamp: new Date().toISOString(),
    };

    this.checkpoints.unshift(checkpoint);

    if (this.checkpoints.length > this.maxEntries) {
      this.checkpoints.length = this.maxEntries;
    }

    return checkpoint;
  }

  public getLatest(targetId?: string): SessionCheckpoint | null {
    if (!targetId) return this.checkpoints[0] ?? null;
    return this.checkpoints.find((c) => c.targetId === targetId) ?? null;
  }

  public getPrevious(targetId: string): SessionCheckpoint | null {
    const matches = this.checkpoints.filter((c) => c.targetId === targetId);
    return matches[1] ?? null;
  }

  public list(targetId?: string): readonly SessionCheckpoint[] {
    if (!targetId) return [...this.checkpoints];
    return this.checkpoints.filter((c) => c.targetId === targetId);
  }

  public clear(): void {
    this.checkpoints.length = 0;
  }
}
