import type { ModelExecutionResult } from "./comparison.types.js";

export interface BuildArbiterPromptParams {
  readonly originalPrompt: string;
  readonly candidateResults: readonly ModelExecutionResult[];
}

export class ArbiterPromptBuilder {
  public static build(params: BuildArbiterPromptParams): string {
    const valid = params.candidateResults.filter((r) => r.status === "success" && r.turn?.markdownContent);
    if (valid.length === 0) {
      throw new Error("Cannot arbitrate without at least one successful candidate solution");
    }

    const sections: string[] = [
      "# Role: Technical Arbiter & Principal Systems Architect",
      "You are the Lead Arbiter. Below is an engineering problem alongside candidate solutions proposed independently by AI models.",
      "",
      "## Original Engineering Task",
      params.originalPrompt.trim(),
      "",
      "## Candidate Solutions for Cross-Examination",
    ];

    valid.forEach((result, idx) => {
      const platformName = this.formatPlatformName(result.platform);
      sections.push(
        `### Candidate ${idx + 1} (Platform: ${platformName})`,
        "```text",
        `Latency: ${result.elapsedMs}ms | Code blocks: ${result.turn?.codeBlocks?.length ?? 0}`,
        "```",
        result.turn?.markdownContent.trim() ?? "",
        "",
      );
    });

    sections.push(
      "## Arbitration Mandate",
      "Perform a rigorous multi-perspective review and consensus synthesis:",
      "1. **Discrepancy & Bug Audit:** Spot logic errors, race conditions, edge-case oversights, or hallucinations across all candidates.",
      "2. **Trade-Off Matrix:** Compare asymptotic performance, memory overhead, API ergonomics, and maintainability.",
      "3. **Synthesized Production Solution:** Deliver the definitive unified code incorporating the strongest elements while correcting flaws.",
      "Provide clear production-ready code with complete type safety and defensive guards.",
    );

    return sections.join("\n");
  }

  private static formatPlatformName(platform: string): string {
    switch (platform.toLowerCase()) {
      case "chatgpt":
        return "ChatGPT";
      case "deepseek":
        return "DeepSeek";
      case "gemini":
        return "Gemini";
      default:
        return platform.toUpperCase();
    }
  }
}
