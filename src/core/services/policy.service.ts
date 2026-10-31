import type { PolicyGatePort, RiskLabel, SanitizedPayload } from "../ports/policy.port.js";

export class PolicyService implements PolicyGatePort {
  // Regex rules for sensitive secrets
  private static readonly SECRET_PATTERNS: Array<{ regex: RegExp; replace: (match: string, ...args: string[]) => string }> = [
    // OpenAI / general API keys (e.g. sk-proj-...)
    {
      regex: /\bsk-[a-zA-Z0-9_-]{20,}\b/g,
      replace: () => "[REDACTED_SECRET]",
    },
    // GitHub personal access tokens (ghp_...)
    {
      regex: /\bghp_[a-zA-Z0-9]{36}\b/g,
      replace: () => "[REDACTED_SECRET]",
    },
    // AWS Secret Access Keys
    {
      regex: /\b(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])\b/g,
      replace: () => "[REDACTED_SECRET]",
    },
    // Generic .env assignments: KEY_NAME=secret_val
    {
      regex: /\b([A-Z0-9_]*(?:KEY|SECRET|PASSWORD|TOKEN|AUTH)[A-Z0-9_]*)=([^\s"'`]+)/gi,
      replace: (_m, key: string) => `${key}=[REDACTED_SECRET]`,
    },
  ];

  // Shell and destructive patterns
  private static readonly DESTRUCTIVE_PATTERNS = [
    /\brm\s+-(?:r[fF]|f[rR]|rf)\b/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    /\bchmod\s+-R\s+777\b/i,
    />\s*\/dev\/sd[a-z]/i,
  ];

  private static readonly SHELL_CODEBLOCK_PATTERN = /```(?:bash|sh|zsh|shell|console)\b/i;

  public sanitizeOutboundPrompt(rawPrompt: string): SanitizedPayload {
    let cleanText = rawPrompt;
    let redactedCount = 0;

    for (const pattern of PolicyService.SECRET_PATTERNS) {
      cleanText = cleanText.replace(pattern.regex, (match, ...args) => {
        redactedCount++;
        return pattern.replace(match, ...(args as string[]));
      });
    }

    const labels: RiskLabel[] = [];
    if (redactedCount > 0) {
      labels.push("contains_redacted_secret");
    }

    return {
      cleanText,
      redactedCount,
      labels,
    };
  }

  public classifyInboundResponse(markdown: string): readonly RiskLabel[] {
    const labels: RiskLabel[] = [];

    const hasShellBlock = PolicyService.SHELL_CODEBLOCK_PATTERN.test(markdown);
    let hasDestructive = false;

    for (const pattern of PolicyService.DESTRUCTIVE_PATTERNS) {
      if (pattern.test(markdown)) {
        hasDestructive = true;
        break;
      }
    }

    if (hasDestructive) {
      labels.push("contains_destructive_command");
    }

    if (hasShellBlock || hasDestructive) {
      labels.push("contains_shell_execution");
    }

    return labels;
  }
}
