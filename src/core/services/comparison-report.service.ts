import type { PlatformId } from "../ports/platform.port.js";
import type {
  ExecutionScheduleMode,
  ModelExecutionResult,
  PlatformMetric,
  ArbitrationResult,
} from "./comparison.types.js";
import type { WorkspaceSinkPort } from "../ports/storage.port.js";

export class ComparisonReportService {
  public computeMetrics(results: readonly ModelExecutionResult[]): PlatformMetric[] {
    return results.map((r) => {
      if (r.status !== "success" || !r.turn) {
        return {
          platform: r.platform,
          status: r.status,
          elapsedMs: r.elapsedMs,
          codeBlockCount: 0,
          totalLinesOfCode: 0,
          characterCount: 0,
        };
      }

      const codeBlocks = r.turn.codeBlocks ?? [];
      const totalLoc = codeBlocks.reduce((acc, b) => acc + (b.code ? b.code.split("\n").length : 0), 0);

      return {
        platform: r.platform,
        status: "success",
        elapsedMs: r.elapsedMs,
        codeBlockCount: codeBlocks.length,
        totalLinesOfCode: totalLoc,
        characterCount: r.turn.markdownContent.length,
      };
    });
  }

  public determineFastestPlatform(metrics: readonly PlatformMetric[]): PlatformId | undefined {
    const successful = metrics.filter((m) => m.status === "success" && m.elapsedMs > 0);
    if (successful.length === 0) return undefined;
    successful.sort((a, b) => a.elapsedMs - b.elapsedMs);
    return successful[0]?.platform;
  }

  public buildMarkdownReport(
    comparisonId: string,
    prompt: string,
    results: readonly ModelExecutionResult[],
    metrics: readonly PlatformMetric[],
    mode: ExecutionScheduleMode = "parallel",
    arbitration?: ArbitrationResult,
  ): string {
    const fastest = this.determineFastestPlatform(metrics);
    const dateStr = new Date().toISOString();

    const tableRows = metrics
      .map((m) => {
        const badge = m.status === "success" ? "✅ Done" : "❌ Failed";
        const duration = m.elapsedMs > 0 ? `${(m.elapsedMs / 1000).toFixed(1)}s` : "-";
        const chars = m.characterCount > 0 ? m.characterCount.toLocaleString() : "-";
        const blocks = m.codeBlockCount > 0 ? `${m.codeBlockCount} (${m.totalLinesOfCode} lines)` : "-";
        const name = this.formatPlatformName(m.platform);
        return `| **${name}** | ${badge} | ${duration} | ${chars} | ${blocks} |`;
      })
      .join("\n");

    const rawSections = results
      .map((r) => {
        const name = this.formatPlatformName(r.platform);
        const content = r.turn ? r.turn.markdownContent : `*Execution Failed: ${r.error || "Unknown error"}*`;
        return `### 💬 ${name} Output\n\n${content}\n`;
      })
      .join("\n---\n\n");

    let arbiterSection = "";
    if (arbitration) {
      const arbiterName = this.formatPlatformName(arbitration.arbiterPlatform);
      const arbiterDuration = arbitration.elapsedMs > 0 ? `${(arbitration.elapsedMs / 1000).toFixed(1)}s` : "-";
      const arbiterContent = arbitration.turn
        ? arbitration.turn.markdownContent
        : `*Arbitration failed: ${arbitration.error || "Unknown error"}*`;

      arbiterSection = `
---

## ⚖️ Technical Arbiter Synthesis (${arbiterName})

> **Arbiter Platform:** \`${arbiterName}\` | **Status:** \`${arbitration.status}\` | **Elapsed:** \`${arbiterDuration}\`

${arbiterContent}
`;
    }

    return `# Multi-Model Comparison: ${prompt}

- **Comparison ID:** \`${comparisonId}\`
- **Timestamp:** \`${dateStr}\`
- **Fastest Model:** \`${fastest ? this.formatPlatformName(fastest) : "N/A"}\`
- **Schedule Mode:** \`${mode}\`

---

## 📊 Quantitative Benchmark Matrix

| Platform | Status | Elapsed | Output Chars | Code Blocks |
| :--- | :--- | :--- | :--- | :--- |
${tableRows}
${arbiterSection}
---

## 📝 Full Model Outputs

${rawSections}
`;
  }

  public async saveNamespacedArtifacts(
    results: readonly ModelExecutionResult[],
    baseOutDir: string,
    fileSink: WorkspaceSinkPort,
  ): Promise<string[]> {
    const saved: string[] = [];
    for (const r of results) {
      if (!r.artifacts || r.artifacts.length === 0) continue;
      const platformDir = `${baseOutDir}/${r.platform}`;
      const res = await fileSink.persist(r.artifacts, { outDir: platformDir, overwrite: true });
      saved.push(...res.writtenFiles.map((f) => f.path));
    }
    return saved;
  }

  private formatPlatformName(platform: PlatformId): string {
    switch (platform) {
      case "chatgpt": return "ChatGPT";
      case "deepseek": return "DeepSeek";
      case "gemini": return "Gemini";
      default: return platform;
    }
  }
}
