import * as fs from "node:fs";
import * as path from "node:path";
import type { DiscoveredProfile } from "./browser-discovery.js";

interface IniSection {
  [key: string]: string;
}

/**
 * Parses Gecko INI format (profiles.ini) used by Firefox and Zen Browser.
 */
function parseIniSections(content: string): Map<string, IniSection> {
  const sections = new Map<string, IniSection>();
  let currentSection = "";
  let currentMap: IniSection = {};

  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      if (currentSection) {
        sections.set(currentSection, currentMap);
      }
      currentSection = trimmed.slice(1, -1);
      currentMap = {};
      continue;
    }

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      currentMap[key] = val;
    }
  }

  if (currentSection) {
    sections.set(currentSection, currentMap);
  }

  return sections;
}

/**
 * Attempts to extract signed-in Firefox / Zen sync account email from profile directory.
 */
async function extractSignedInEmail(profileDir: string): Promise<string> {
  const userJsonPath = path.join(profileDir, "signedInUser.json");
  if (!fs.existsSync(userJsonPath)) return "";

  try {
    const content = await fs.promises.readFile(userJsonPath, "utf8");
    const parsed = JSON.parse(content);
    return parsed?.accountData?.email ? String(parsed.accountData.email) : "";
  } catch {
    return "";
  }
}

/**
 * Reads Gecko profiles.ini and enumerates active profiles with their direct directories.
 */
export async function parseGeckoProfiles(
  rootDir: string,
  browserName: string,
): Promise<DiscoveredProfile[]> {
  const iniPath = path.join(rootDir, "profiles.ini");
  if (!fs.existsSync(iniPath)) return [];

  try {
    const rawIni = await fs.promises.readFile(iniPath, "utf8");
    const sections = parseIniSections(rawIni);
    const profiles: DiscoveredProfile[] = [];

    for (const [sectionName, data] of sections.entries()) {
      if (!sectionName.toLowerCase().startsWith("profile")) continue;
      const rawPath = data.Path;
      if (!rawPath) continue;

      const isRelative = data.IsRelative !== "0";
      const profileDir = isRelative ? path.join(rootDir, rawPath) : rawPath;
      const name = data.Name || path.basename(profileDir);
      const email = await extractSignedInEmail(profileDir);

      profiles.push({
        browser: browserName,
        profileId: name,
        name,
        email,
        userDataDir: profileDir,
      });
    }

    return profiles;
  } catch {
    return [];
  }
}
