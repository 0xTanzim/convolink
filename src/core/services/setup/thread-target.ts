import type { PlatformId } from "../../ports/platform.port.js";

export interface ThreadTarget {
  readonly platform: PlatformId;
  readonly threadId: string;
  readonly url: string;
}

export interface ThreadTargetError {
  readonly code: "configuration-invalid" | "thread-not-found";
  readonly message: string;
  readonly remediation: string;
}

export type ThreadParseResult =
  | { readonly ok: true; readonly target: ThreadTarget }
  | { readonly ok: false; readonly error: ThreadTargetError };

const HOSTS: Readonly<Record<PlatformId, readonly string[]>> = {
  chatgpt: ["chatgpt.com", "chat.openai.com"],
  claude: ["claude.ai"],
  deepseek: ["chat.deepseek.com"],
  gemini: ["gemini.google.com"],
};

const ID_PATTERNS: Readonly<Record<PlatformId, RegExp>> = {
  chatgpt: /\/c\/([A-Za-z0-9-]+)/,
  claude: /\/chat\/([A-Za-z0-9-]+)/,
  deepseek: /\/a\/chat\/s\/([A-Za-z0-9-]+)/,
  gemini: /\/app\/([A-Za-z0-9]+)/,
};

function invalid(message: string): ThreadParseResult {
  return {
    ok: false,
    error: {
      code: "configuration-invalid",
      message,
      remediation: "Pass a conversation URL such as https://chatgpt.com/c/<id> or https://chat.deepseek.com/a/chat/s/<id>.",
    },
  };
}

/**
 * A visitable conversation URL is the user's explicit consent to drive that
 * thread. Host and id shape are validated here so no unknown page is touched.
 */
export function parseThreadUrl(input: string): ThreadParseResult {
  const raw = input.trim();
  if (!raw) return invalid("Thread URL is empty.");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return invalid(`'${raw}' is not a valid URL.`);
  }
  if (url.protocol !== "https:") return invalid("Thread URLs must use https.");

  const platform = (Object.keys(HOSTS) as PlatformId[]).find((candidate) =>
    HOSTS[candidate]?.includes(url.hostname),
  );
  if (!platform) {
    return invalid(`Unsupported conversation host '${url.hostname}'.`);
  }

  const match = ID_PATTERNS[platform]?.exec(url.pathname);
  if (!match?.[1]) {
    return invalid(`That ${platform} URL does not point at a conversation.`);
  }
  if (platform === "gemini") {
    return invalid(
      "Gemini conversation URLs are not stable enough to target; pass the platform and continue the open thread instead.",
    );
  }

  return {
    ok: true,
    target: { platform, threadId: match[1], url: url.toString() },
  };
}

/**
 * Gemini exposes no stable per-conversation URL (only read-only `/share/`
 * links), and platforms report `default` until a conversation exists. Neither
 * can be handed back as a continuation handle.
 */
export function isContinuableThread(platform: PlatformId, threadId: string | null | undefined): boolean {
  if (platform === "gemini") return false;
  return typeof threadId === "string" && threadId.length > 0 && threadId !== "default";
}

/** `chatgpt=https://…,deepseek=https://…` — one conversation per platform. */
export function parseThreadList(input: string): { readonly ok: true; readonly targets: ThreadTarget[] } | { readonly ok: false; readonly error: ThreadTargetError } {
  const targets: ThreadTarget[] = [];
  for (const entry of input.split(",").map((part) => part.trim()).filter(Boolean)) {
    const separator = entry.indexOf("=");
    if (separator === -1) {
      return {
        ok: false,
        error: {
          code: "configuration-invalid",
          message: `'${entry}' must be <platform>=<url>.`,
          remediation: "Example: --threads chatgpt=https://chatgpt.com/c/<id>",
        },
      };
    }
    const platform = entry.slice(0, separator).trim() as PlatformId;
    const parsed = parseThreadUrl(entry.slice(separator + 1));
    if (!parsed.ok) return parsed;
    if (parsed.target.platform !== platform) {
      return {
        ok: false,
        error: {
          code: "configuration-invalid",
          message: `${parsed.target.url} is a ${parsed.target.platform} URL, not ${platform}.`,
          remediation: "Match each --threads entry to its own platform.",
        },
      };
    }
    targets.push(parsed.target);
  }

  if (targets.length === 0) {
    return {
      ok: false,
      error: {
        code: "configuration-invalid",
        message: "No thread URLs were provided.",
        remediation: "Example: --threads chatgpt=https://chatgpt.com/c/<id>",
      },
    };
  }
  return { ok: true, targets };
}
