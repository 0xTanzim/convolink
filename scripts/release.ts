import fs from "node:fs";
import path from "node:path";
import { buildExtension, getProjectVersion } from "./build-extension.js";

const ROOT_DIR = path.resolve(import.meta.dir, "..");
const EXT_ROOT = path.join(ROOT_DIR, "extensions/convolink-companion");

export function parseTargetVersion(input: string | undefined, currentVersion: string): string {
  if (!input || input === "current") return currentVersion;
  const clean = input.replace(/^v/, "").trim();
  const parts = currentVersion.split(".").map((n) => parseInt(n, 10));
  const major = parts[0] ?? 1;
  const minor = parts[1] ?? 0;
  const patch = parts[2] ?? 0;

  if (clean === "patch") return `${major}.${minor}.${patch + 1}`;
  if (clean === "minor") return `${major}.${minor + 1}.0`;
  if (clean === "major") return `${major + 1}.0.0`;
  return clean;
}

export function syncPackageVersions(version: string): void {
  const rootPkgPath = path.join(ROOT_DIR, "package.json");
  if (fs.existsSync(rootPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(rootPkgPath, "utf-8"));
    pkg.version = version;
    fs.writeFileSync(rootPkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  }

  const extPkgPath = path.join(EXT_ROOT, "package.json");
  if (fs.existsSync(extPkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(extPkgPath, "utf-8"));
    pkg.version = version;
    fs.writeFileSync(extPkgPath, JSON.stringify(pkg, null, 2) + "\n", "utf-8");
  }
}

export function formatReleaseNotes(version: string): string {
  return `## ConvoLink Companion v${version}

### 📦 Included Extension Packages
- **Chromium Browsers (Chrome, Brave, Edge):** \`convolink-companion-chrome.zip\`
- **Mozilla Firefox:** \`convolink-companion-firefox.zip\`

### 🚀 Highlights
- **Zero-Flag Extension Bridge:** Connects local autonomous agents directly to everyday authenticated browser profiles without yellow warning banners or browser restarts.
- **Provider DOM Automation:** Native prompt submission, stream settling detection, and multi-file artifact extraction for ChatGPT, DeepSeek, Claude, and Gemini.
- **Cryptographic Pairing Security:** Non-blocking pairing handshake via \`convo ext pair\` protecting local WebSocket endpoints from cross-site access.
`;
}

export async function runRelease(targetArg?: string, dryRun = false): Promise<void> {
  const current = getProjectVersion();
  const targetVersion = parseTargetVersion(targetArg, current);
  const tag = `v${targetVersion}`;

  console.log(`\n🚀 Preparing Release ${tag} (Current: v${current})...`);

  // 1. Sync versions
  syncPackageVersions(targetVersion);
  console.log(`✅ Synchronized package.json versions to ${targetVersion}`);

  // 2. Build extension packages
  console.log("📦 Building Chrome and Firefox extension archives...");
  const chromeRes = await buildExtension({ target: "chrome", zip: true, version: targetVersion });
  const ffRes = await buildExtension({ target: "firefox", zip: true, version: targetVersion });

  if (!chromeRes.success || !ffRes.success) {
    console.error("❌ Failed to build extensions:", chromeRes.error || ffRes.error);
    process.exit(1);
  }

  const assets: string[] = [
    chromeRes.zipPath!,
    chromeRes.versionedZipPath!,
    ffRes.zipPath!,
    ffRes.versionedZipPath!,
  ].filter(Boolean);

  console.log(`✅ Generated ${assets.length} release assets:`);
  for (const a of assets) console.log(`   • ${path.basename(a)}`);

  if (dryRun) {
    console.log("\n🔍 [DRY-RUN] Finished build & validation. Skipping git and gh release.");
    return;
  }

  // 3. Git commit & tag
  console.log("\n📝 Staging and committing release changes...");
  Bun.spawnSync(["git", "add", "."], { cwd: ROOT_DIR });
  Bun.spawnSync(["git", "commit", "-m", `chore(release): ${tag}`], { cwd: ROOT_DIR });

  // Delete existing local tag if exists then re-tag
  Bun.spawnSync(["git", "tag", "-d", tag], { cwd: ROOT_DIR });
  const tagProc = Bun.spawnSync(["git", "tag", "-a", tag, "-m", `Release ${tag}`], { cwd: ROOT_DIR });
  if (tagProc.exitCode !== 0) {
    console.error("❌ Git tagging failed:", tagProc.stderr.toString());
    process.exit(1);
  }

  // 4. Push commit and tag to origin
  console.log("⬆️ Pushing commits and tags to origin/main...");
  const pushProc = Bun.spawnSync(["git", "push", "origin", "main", "--tags", "--force"], { cwd: ROOT_DIR });
  if (pushProc.exitCode !== 0) {
    console.warn("⚠️ Push warning:", pushProc.stderr.toString());
  }

  // 5. GitHub Release using gh CLI
  console.log(`🌐 Creating GitHub Release ${tag} via gh tools...`);
  const notes = formatReleaseNotes(targetVersion);

  // Check if release exists
  const viewProc = Bun.spawnSync(["gh", "release", "view", tag], { cwd: ROOT_DIR });
  if (viewProc.exitCode === 0) {
    // Release exists, upload assets with clobber
    console.log(`Updating existing release ${tag} with assets...`);
    const uploadProc = Bun.spawnSync(["gh", "release", "upload", tag, ...assets, "--clobber"], { cwd: ROOT_DIR });
    if (uploadProc.exitCode !== 0) {
      console.error("❌ Failed to upload assets to GitHub release:", uploadProc.stderr.toString());
      process.exit(1);
    }
  } else {
    // Create new release
    const createProc = Bun.spawnSync([
      "gh", "release", "create", tag,
      ...assets,
      "--title", `ConvoLink Companion ${tag}`,
      "--notes", notes,
    ], { cwd: ROOT_DIR });

    if (createProc.exitCode !== 0) {
      console.error("❌ Failed to create GitHub release via gh CLI:", createProc.stderr.toString());
      process.exit(1);
    }
  }

  console.log(`\n🎉 Release ${tag} successfully published to GitHub with all extension ZIPs!`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const target = args.find((a) => !a.startsWith("--")) || "current";
  await runRelease(target, dryRun);
}
