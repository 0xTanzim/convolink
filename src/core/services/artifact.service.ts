import type { CodeBlock } from "../ports/platform.port.js";

export interface ExtractedArtifact {
  readonly relativePath: string;
  readonly language: string;
  readonly content: string;
  readonly isExplicitPath: boolean;
}

export class ArtifactService {
  private static readonly CODE_BLOCK_REGEX = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;

  private static readonly DIRECTIVE_PATTERNS = [
    /^(?:\/\/|#|\/\*)\s*(?:filepath|file):\s*([^\s*]+)(?:\s*\*\/)?\s*\n?/i,
    /^<!--\s*(?:filepath|file):\s*([^\s>]+)\s*-->\s*\n?/i,
  ];

  private static readonly EXTENSION_MAP: Record<string, string> = {
    typescript: ".ts",
    ts: ".ts",
    javascript: ".js",
    js: ".js",
    python: ".py",
    py: ".py",
    json: ".json",
    markdown: ".md",
    md: ".md",
    bash: ".sh",
    sh: ".sh",
    html: ".html",
    css: ".css",
    yaml: ".yaml",
    yml: ".yaml",
    sql: ".sql",
    rust: ".rs",
    rs: ".rs",
  };

  public extractArtifacts(markdown: string, codeBlocks?: readonly CodeBlock[]): ExtractedArtifact[] {
    const artifacts: ExtractedArtifact[] = [];
    const seenPaths = new Set<string>();
    let fallbackCounter = 1;

    // 1. If structured DOM codeBlocks are provided, treat them as the authoritative source
    if (codeBlocks && codeBlocks.length > 0) {
      for (const block of codeBlocks) {
        const item = this.parseBlock(block.language, block.code, fallbackCounter);
        if (!item.isExplicitPath) fallbackCounter++;
        if (!seenPaths.has(item.relativePath)) {
          seenPaths.add(item.relativePath);
          artifacts.push(item);
        }
      }
      return artifacts;
    }

    // 2. Otherwise fall back to regex scanning on the raw markdown string
    const matches = Array.from(markdown.matchAll(ArtifactService.CODE_BLOCK_REGEX));
    for (const match of matches) {
      const item = this.parseBlock(match[1] || "text", match[2] || "", fallbackCounter);
      if (!item.isExplicitPath) fallbackCounter++;
      if (!seenPaths.has(item.relativePath)) {
        seenPaths.add(item.relativePath);
        artifacts.push(item);
      }
    }

    return artifacts;
  }

  private parseBlock(language: string, rawContent: string, fallbackCounter: number): ExtractedArtifact {
    let content = rawContent;
    let extractedPath: string | null = null;

    for (const pattern of ArtifactService.DIRECTIVE_PATTERNS) {
      const dirMatch = content.match(pattern);
      if (dirMatch && dirMatch[1]) {
        extractedPath = dirMatch[1].trim();
        content = content.slice(dirMatch[0].length);
        break;
      }
    }

    const isExplicitPath = Boolean(extractedPath);
    const relativePath = isExplicitPath && extractedPath
      ? this.sanitizePath(extractedPath)
      : this.generateFallbackPath(fallbackCounter, language.toLowerCase());

    return {
      relativePath,
      language: language.toLowerCase(),
      content: content.trimEnd() + "\n",
      isExplicitPath,
    };
  }

  public sanitizePath(raw: string): string {
    // Strip leading slashes, backslashes, and replace traversal sequences
    let cleaned = raw.replace(/^[\/\\]+/, "");
    // Normalize path separators
    cleaned = cleaned.replace(/\\/g, "/");
    // Strip traversal tokens
    const segments = cleaned.split("/").filter((s) => s.length > 0 && s !== ".." && s !== ".");
    return segments.join("/") || "unnamed-artifact";
  }

  private generateFallbackPath(counter: number, language: string): string {
    const ext = ArtifactService.EXTENSION_MAP[language] || ".txt";
    return `artifact-${counter}${ext}`;
  }
}
