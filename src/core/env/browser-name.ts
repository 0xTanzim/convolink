import type { BrowserAdapterId, BrowserFamily } from "../ports/browser.port.js";

export type CanonicalBrowserId =
  | "chrome"
  | "firefox"
  | "zen"
  | "brave"
  | "edge"
  | "companion"
  | "auto";

export interface CanonicalBrowserInfo {
  readonly id: CanonicalBrowserId;
  readonly displayName: string;
  readonly family: BrowserFamily;
  readonly transport: BrowserAdapterId;
  readonly defaultPort: number;
}

export function normalizeBrowserName(input?: string): CanonicalBrowserInfo {
  const raw = (input || "").trim().toLowerCase();
  if (!raw || raw === "auto" || raw === "any" || raw === "default") {
    return {
      id: "auto",
      displayName: "Auto (Chromium / Best Available)",
      family: "chromium",
      transport: "raw-cdp",
      defaultPort: 9222,
    };
  }

  if (raw.includes("zen")) {
    return {
      id: "zen",
      displayName: "Zen Browser",
      family: "firefox",
      transport: "firefox-bidi",
      defaultPort: 9223,
    };
  }

  if (raw.includes("firefox")) {
    return {
      id: "firefox",
      displayName: "Mozilla Firefox",
      family: "firefox",
      transport: "firefox-bidi",
      defaultPort: 9223,
    };
  }

  if (raw.includes("brave")) {
    return {
      id: "brave",
      displayName: "Brave Browser",
      family: "chromium",
      transport: "raw-cdp",
      defaultPort: 9222,
    };
  }

  if (raw.includes("edge") || raw.includes("msedge")) {
    return {
      id: "edge",
      displayName: "Microsoft Edge",
      family: "chromium",
      transport: "raw-cdp",
      defaultPort: 9222,
    };
  }

  if (raw.includes("companion") || raw.includes("ext")) {
    return {
      id: "companion",
      displayName: "ConvoLink Companion Extension",
      family: "extension",
      transport: "extension-bridge",
      defaultPort: 9224,
    };
  }

  return {
    id: "chrome",
    displayName: "Google Chrome",
    family: "chromium",
    transport: "raw-cdp",
    defaultPort: 9222,
  };
}

export function isGeckoBrowser(name?: string): boolean {
  const norm = normalizeBrowserName(name);
  return norm.family === "firefox";
}

export function isChromiumBrowser(name?: string): boolean {
  const norm = normalizeBrowserName(name);
  return norm.family === "chromium";
}
