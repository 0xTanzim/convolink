import type { ModelExecutionResult } from "./comparison.types.js";

export interface BuildArbiterPromptParams {
  readonly originalPrompt: string;
  readonly candidateResults: readonly ModelExecutionResult[];
  readonly anonymize?: boolean;
}

export class ArbiterPromptBuilder {
  private static readonly BRAND_REGEX = /\b(OpenAI|ChatGPT|Anthropic|Claude|Google Gemini|DeepSeek)\b/gi;

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
      const header = params.anonymize
        ? `### Candidate ${String.fromCharCode(65 + idx)}`
        : `### Candidate ${idx + 1} (Platform: ${this.formatPlatformName(result.platform)})`;
      const rawContent = result.turn?.markdownContent.trim() ?? "";
      const content = params.anonymize ? rawContent.replace(this.BRAND_REGEX, "[AI Model]") : rawContent;

      sections.push(
        header,
        "```text",
        `Latency: ${result.elapsedMs}ms | Code blocks: ${result.turn?.codeBlocks?.length ?? 0}`,
        "```",
        content,
        "",
      );
    });

    sections.push(
      "## Arbitration Mandate",
      "Perform a rigorous multi-perspective review and consensus synthesis:",
      params.anonymize
        ? "1. **Crux-of-Disagreement Extraction:** Identify exactly where candidates disagree in architecture, concurrency, or algorithmic invariants."
        : "1. **Discrepancy & Bug Audit:** Spot logic errors, race conditions, edge-case oversights, or hallucinations across all candidates.",
      params.anonymize
        ? "2. **Discrepancy & Bug Audit:** Spot logic errors, race conditions, edge-case oversights, or hallucinations across all candidates."
        : "2. **Trade-Off Matrix:** Compare asymptotic performance, memory overhead, API ergonomics, and maintainability.",
      params.anonymize
        ? "3. **Trade-Off Matrix:** Compare asymptotic performance, memory overhead, API ergonomics, and maintainability."
        : "3. **Synthesized Production Solution:** Deliver the definitive unified code incorporating the strongest elements while correcting flaws.",
      params.anonymize
        ? "4. **Synthesized Production Solution:** Deliver the definitive unified code incorporating the strongest elements while correcting flaws."
        : "Provide clear production-ready code with complete type safety and defensive guards.",
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
