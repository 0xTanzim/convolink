export type RiskLabel =
  | "contains_shell_execution"
  | "contains_destructive_command"
  | "contains_redacted_secret";

export interface SanitizedPayload {
  readonly cleanText: string;
  readonly redactedCount: number;
  readonly labels: readonly RiskLabel[];
}

export interface PolicyGatePort {
  /** Scrubs outgoing local secrets (.env keys, tokens) before sending to web browser */
  sanitizeOutboundPrompt(rawPrompt: string): SanitizedPayload;

  /** Labels inbound AI responses for risky commands WITHOUT blocking stdio */
  classifyInboundResponse(markdown: string): readonly RiskLabel[];
}
