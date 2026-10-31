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

  it("redacts generic JWT tokens from outbound prompts", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    const input = `Authorization: Bearer ${jwt} in request header`;
    const result = policy.sanitizeOutboundPrompt(input);

    expect(result.cleanText).not.toContain(jwt);
    expect(result.cleanText).toContain("Bearer [REDACTED_SECRET] in request header");
    expect(result.labels).toContain("contains_redacted_secret");
  });

  it("redacts AWS Access Key IDs (AKIA...)", () => {
    const input = "AWS credentials: access_key=AKIAIOSFODNN7EXAMPLE end";
    const result = policy.sanitizeOutboundPrompt(input);

    expect(result.cleanText).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.cleanText).toContain("access_key=[REDACTED_SECRET] end");
  });

  it("redacts AWS Secret Access Keys while preserving 40-character Git commit hashes", () => {
    const awsSecret = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
    const commitHash = "c3ab8ff13720e8ad9047dd39466b3c8974e592c2";
    const input = `Secret is ${awsSecret} and git commit is ${commitHash}`;
    const result = policy.sanitizeOutboundPrompt(input);

    expect(result.cleanText).not.toContain(awsSecret);
    expect(result.cleanText).toContain(commitHash);
    expect(result.cleanText).toContain("[REDACTED_SECRET]");
  });

  it("redacts quoted .env assignments with double and single quotes", () => {
    const inputDouble = 'API_KEY="sk-proj-my-secret-key-12345"';
    const resultDouble = policy.sanitizeOutboundPrompt(inputDouble);
    expect(resultDouble.cleanText).toBe("API_KEY=[REDACTED_SECRET]");

    const inputSingle = "AUTH_TOKEN='my-super-secret-auth-token'";
    const resultSingle = policy.sanitizeOutboundPrompt(inputSingle);
    expect(resultSingle.cleanText).toBe("AUTH_TOKEN=[REDACTED_SECRET]");
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
