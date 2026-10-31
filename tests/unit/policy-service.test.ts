import { describe, expect, it } from "bun:test";
import { PolicyService } from "../../src/core/services/policy.service.js";

describe("PolicyService", () => {
  const policy = new PolicyService();

  it("redacts sensitive OpenAI API keys from outbound prompts", () => {
    const input = "Here is my secret sk-proj-123456789012345678901234567890 and please fix it.";
    const result = policy.sanitizeOutboundPrompt(input);

    expect(result.cleanText).not.toContain("sk-proj-123456789012345678901234567890");
    expect(result.cleanText).toContain("[REDACTED_SECRET]");
    expect(result.redactedCount).toBe(1);
    expect(result.labels).toContain("contains_redacted_secret");
  });

  it("redacts GitHub personal access tokens from outbound prompts", () => {
    const input = "Use token ghp_123456789012345678901234567890123456 to clone.";
    const result = policy.sanitizeOutboundPrompt(input);

    expect(result.cleanText).not.toContain("ghp_123456789012345678901234567890123456");
    expect(result.cleanText).toContain("[REDACTED_SECRET]");
    expect(result.redactedCount).toBe(1);
  });

  it("redacts .env assignments like DB_PASSWORD=secret123", () => {
    const input = "Config has DB_PASSWORD=mySuperSecretValue123! in production";
    const result = policy.sanitizeOutboundPrompt(input);

    expect(result.cleanText).not.toContain("mySuperSecretValue123!");
    expect(result.cleanText).toContain("DB_PASSWORD=[REDACTED_SECRET]");
    expect(result.redactedCount).toBe(1);
  });

  it("classifies inbound responses containing destructive shell commands", () => {
    const responseWithDestructive = "Run this in your terminal:\n```bash\nrm -rf /var/log/*\n```";
    const labels = policy.classifyInboundResponse(responseWithDestructive);

    expect(labels).toContain("contains_destructive_command");
    expect(labels).toContain("contains_shell_execution");
  });

  it("classifies normal non-destructive responses cleanly without false positives", () => {
    const response = "You can calculate this with `console.log(2 + 2);`";
    const labels = policy.classifyInboundResponse(response);

    expect(labels).toHaveLength(0);
  });
});
