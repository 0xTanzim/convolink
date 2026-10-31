import type { DiscoveredTab, AskResult } from "./orchestrator.types.js";
import type { ExecutionScheduleMode, ModelExecutionResult } from "./comparison.types.js";

export type AskRunner = (tab: DiscoveredTab, prompt: string, timeoutMs?: number) => Promise<AskResult>;

export interface ExecutionParams {
  readonly prompt: string;
  readonly tabs: readonly DiscoveredTab[];
  readonly mode?: ExecutionScheduleMode;
  readonly timeoutMs?: number;
  readonly staggerMs?: number;
}

export class ComparisonEngineService {
  private readonly askRunner: AskRunner;

  public constructor(askRunner: AskRunner) {
    this.askRunner = askRunner;
  }

  public async executeComparison(params: ExecutionParams): Promise<ModelExecutionResult[]> {
    const mode = params.mode ?? "parallel";
    const staggerMs = params.staggerMs ?? 250;

    if (mode === "sequential") {
      return this.executeSequential(params);
    }
    return this.executeParallel(params, staggerMs);
  }

  private async executeParallel(params: ExecutionParams, staggerMs: number): Promise<ModelExecutionResult[]> {
    const promises = params.tabs.map(async (tab, index) => {
      if (index > 0 && staggerMs > 0) {
        await new Promise((r) => setTimeout(r, index * staggerMs));
      }
      return this.runSingleTab(tab, params.prompt, params.timeoutMs);
    });

    const settled = await Promise.allSettled(promises);
    return settled.map((res, i) => {
      if (res.status === "fulfilled") return res.value;
      const tab = params.tabs[i]!;
      return {
        platform: tab.platformId ?? "chatgpt",
        tab,
        status: "failed",
        elapsedMs: 0,
        error: res.reason instanceof Error ? res.reason.message : String(res.reason),
      };
    });
  }

  private async executeSequential(params: ExecutionParams): Promise<ModelExecutionResult[]> {
    const results: ModelExecutionResult[] = [];
    for (const tab of params.tabs) {
      const res = await this.runSingleTab(tab, params.prompt, params.timeoutMs);
      results.push(res);
    }
    return results;
  }

  private async runSingleTab(tab: DiscoveredTab, prompt: string, timeoutMs?: number): Promise<ModelExecutionResult> {
    const platform = tab.platformId ?? "chatgpt";
    const start = Date.now();
    try {
      const askResult = await this.askRunner(tab, prompt, timeoutMs);
      return {
        platform,
        tab,
        status: "success",
        elapsedMs: askResult.elapsedMs || Date.now() - start,
        turn: askResult.turn,
        artifacts: askResult.artifacts,
      };
    } catch (err: unknown) {
      return {
        platform,
        tab,
        status: "failed",
        elapsedMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
