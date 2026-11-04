import type { DiscoveredTab, AskResult } from "./orchestrator.types.js";
import type { ExecutionScheduleMode, ModelExecutionResult, ArbitrationResult } from "./comparison.types.js";
import type { PlatformId } from "../ports/platform.port.js";
import { ArbiterPromptBuilder } from "./arbiter-prompt.builder.js";

export type AskRunner = (tab: DiscoveredTab, prompt: string, timeoutMs?: number) => Promise<AskResult>;

export interface ExecutionParams {
  readonly prompt: string;
  readonly tabs: readonly DiscoveredTab[];
  readonly mode?: ExecutionScheduleMode;
  readonly timeoutMs?: number;
  readonly staggerMs?: number;
  readonly focusCycler?: (targetId: string) => Promise<void>;
  readonly focusCycleIntervalMs?: number;
}

export interface ArbitrationParams extends ExecutionParams {
  readonly arbitrate?: boolean;
  readonly arbiter?: PlatformId;
  readonly arbiterTab?: DiscoveredTab;
}

export interface ComparisonExecutionOutput {
  readonly results: ModelExecutionResult[];
  readonly arbitration?: ArbitrationResult;
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

  public async executeComparisonWithArbitration(params: ArbitrationParams): Promise<ComparisonExecutionOutput> {
    const results = await this.executeComparison(params);
    if (!params.arbitrate) {
      return { results };
    }

    const arbiterTab = this.resolveArbiterTab(params, results);
    const validCandidates = results.filter((r) => r.status === "success" && r.turn?.markdownContent);
    if (!arbiterTab || validCandidates.length === 0) {
      return { results };
    }

    const prompt = ArbiterPromptBuilder.build({
      originalPrompt: params.prompt,
      candidateResults: results,
    });

    const exec = await this.runSingleTab(arbiterTab, prompt, params.timeoutMs);
    const arbitration: ArbitrationResult = {
      arbiterPlatform: arbiterTab.platformId ?? "chatgpt",
      status: exec.status,
      elapsedMs: exec.elapsedMs,
      turn: exec.turn,
      artifacts: exec.artifacts,
      error: exec.error,
    };

    return { results, arbitration };
  }

  private resolveArbiterTab(params: ArbitrationParams, results: ModelExecutionResult[]): DiscoveredTab | undefined {
    if (params.arbiterTab) return params.arbiterTab;
    if (params.arbiter) {
      return params.tabs.find((t) => t.platformId === params.arbiter);
    }
    // Default priority: deepseek -> first successful candidate -> first tab
    const deepseekTab = params.tabs.find((t) => t.platformId === "deepseek");
    if (deepseekTab) return deepseekTab;
    const firstSuccessful = results.find((r) => r.status === "success");
    return firstSuccessful?.tab ?? params.tabs[0];
  }

  private async executeParallel(params: ExecutionParams, staggerMs: number): Promise<ModelExecutionResult[]> {
    const pendingTabIds = new Set(params.tabs.map((t) => t.targetId));
    let cycleTimer: ReturnType<typeof setInterval> | undefined;

    if (params.focusCycler && params.tabs.length > 1) {
      const cycleInterval = params.focusCycleIntervalMs ?? 1500;
      let currentIndex = 0;
      cycleTimer = setInterval(() => {
        const pendingList = params.tabs.filter((t) => pendingTabIds.has(t.targetId));
        if (pendingList.length <= 1) {
          if (cycleTimer) clearInterval(cycleTimer);
          return;
        }
        currentIndex = (currentIndex + 1) % pendingList.length;
        const target = pendingList[currentIndex];
        if (target) params.focusCycler!(target.targetId).catch(() => {});
      }, cycleInterval);
    }

    try {
      const promises = params.tabs.map(async (tab, index) => {
        if (index > 0 && staggerMs > 0) {
          await new Promise((r) => setTimeout(r, index * staggerMs));
        }
        try {
          return await this.runSingleTab(tab, params.prompt, params.timeoutMs);
        } finally {
          pendingTabIds.delete(tab.targetId);
        }
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
    } finally {
      if (cycleTimer) clearInterval(cycleTimer);
    }
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
