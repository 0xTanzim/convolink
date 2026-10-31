import type { BrowserPort, SessionHandle } from "./browser.port.js";

export type PlatformId = "deepseek" | "chatgpt" | "gemini" | "claude";

export interface CodeBlock {
  readonly language: string;
  readonly code: string;
}

export interface ConversationTurn {
  readonly turnIndex: number;
  readonly role: "user" | "assistant";
  readonly markdownContent: string;
  readonly codeBlocks: CodeBlock[];
  readonly contentHash: string;
}

export interface SelectorResolution {
  readonly ok: boolean;
  readonly layoutVariant: string;
  readonly composerSelector: string | null;
  readonly sendButtonSelector: string | null;
  readonly stopIndicatorSelector: string | null;
  readonly turnContainerSelector: string | null;
  readonly blockerState?: "auth_required" | "captcha" | "rate_limited" | null;
}

export interface ToggleOptions {
  readonly search?: boolean;
  readonly think?: boolean;
}

export interface TurnFingerprint {
  readonly turnCount: number;
  readonly lastTurnHash: string;
  readonly submittedPromptHash?: string;
}

export interface CompletionResult {
  readonly status: "complete" | "incomplete_timeout" | "interrupted";
  readonly turn: ConversationTurn;
  readonly elapsedMs: number;
}

export interface CanvasDocument {
  readonly title: string;
  readonly content: string;
  readonly language?: string;
}

export interface ContinuationTrigger {
  readonly hasContinuation: boolean;
  readonly triggerSelector?: string;
}

export interface DownloadLinkDescriptor {
  readonly url: string;
  readonly filename?: string;
  readonly label?: string;
}

export interface PlatformPort {
  readonly id: PlatformId;

  matchesUrl(url: string): boolean;
  extractThreadId(url: string): string;

  /** Tests selector fallback chains against live DOM without mutating state */
  resolveSelectors(handle: SessionHandle, browser: BrowserPort): Promise<SelectorResolution>;

  /** Cold path: extracts full or partial conversation with intact code indentation */
  readThread(
    handle: SessionHandle,
    browser: BrowserPort,
    options?: { lastNTurns?: number }
  ): Promise<{ layoutVariant: string; turns: ConversationTurn[] }>;

  /** Configures platform-specific toggles (DeepSeek Search/DeepThink, etc.) */
  applyToggles(handle: SessionHandle, browser: BrowserPort, toggles: ToggleOptions): Promise<void>;

  /** Injects prompt and triggers submission, returning pre-submission fingerprint */
  submitPrompt(
    handle: SessionHandle,
    browser: BrowserPort,
    prompt: string,
    files?: string[]
  ): Promise<TurnFingerprint>;

  /** Waits for generation completion via in-page observer promise; returns partial on timeout */
  awaitCompletion(
    handle: SessionHandle,
    browser: BrowserPort,
    before: TurnFingerprint,
    timeoutMs: number
  ): Promise<CompletionResult>;

  /** Inspects secondary Canvas or artifact drawer if open */
  inspectCanvas?(handle: SessionHandle, browser: BrowserPort): Promise<CanvasDocument | null>;

  /** Checks if the turn halted with an active continuation trigger */
  findContinuationTrigger?(handle: SessionHandle, browser: BrowserPort): Promise<ContinuationTrigger>;

  /** Clicks the continuation trigger */
  triggerContinuation?(handle: SessionHandle, browser: BrowserPort): Promise<void>;

  /** Scans for downloadable file links or blobs generated in the active turn */
  findDownloadLinks?(handle: SessionHandle, browser: BrowserPort): Promise<DownloadLinkDescriptor[]>;

  /** Canonical base URL to open a new session for this platform */
  getBaseUrl(): string;

  /** Resets or starts a new conversation in the active tab without creating a new tab */
  startNewChat?(handle: SessionHandle, browser: BrowserPort): Promise<void>;
}
