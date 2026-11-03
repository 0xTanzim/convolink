import fs from "node:fs";
import path from "node:path";

export interface BuildOptions {
  readonly target: "chrome" | "firefox" | "all";
  readonly outDir?: string;
  readonly zip?: boolean;
  readonly version?: string;
}

export interface BuildResult {
  readonly success: boolean;
  readonly outDir: string;
  readonly zipPath?: string;
  readonly versionedZipPath?: string;
  readonly version?: string;
  readonly error?: string;
}

const ROOT_DIR = path.resolve(import.meta.dir, "..");
const EXT_ROOT = path.join(ROOT_DIR, "extensions/convolink-companion");
const AI_HOSTS = [
  "https://chatgpt.com/*",
  "https://chat.deepseek.com/*",
  "https://gemini.google.com/*",
  "https://claude.ai/*",
];

export function getProjectVersion(): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf-8")) as { version?: string };
    if (pkg.version) return pkg.version;
  } catch {}
  return "1.0.0";
}

export function buildManifest(target: "chrome" | "firefox", version: string): Record<string, unknown> {
  return {
    manifest_version: 3,
    name: "ConvoLink Companion",
    version,
    description: "Zero-flag intelligence & context bridge for ConvoLink and local AI agents.",
    permissions: ["tabs", "storage", "alarms", "scripting"],
    host_permissions: AI_HOSTS,
    background:
      target === "firefox"
        ? { scripts: ["background.js"], type: "module" }
        : { service_worker: "background.js", type: "module" },
    action: {
      default_popup: "popup.html",
      default_title: "ConvoLink Companion",
    },
    ...(target === "firefox"
      ? { browser_specific_settings: { gecko: { id: "companion@convolink.local", strict_min_version: "109.0" } } }
      : {}),
  };
}

async function bundle(entry: string, outDir: string, naming: string): Promise<void> {
  const result = await Bun.build({ entrypoints: [entry], outdir: outDir, naming, target: "browser", minify: false });
  if (!result.success) {
    throw new Error(result.logs.map((log) => log.message).join("\n") || `Failed to build ${entry}`);
  }
}

export async function buildExtension(options: BuildOptions): Promise<BuildResult> {
  const target = options.target === "firefox" ? "firefox" : "chrome";
  const outDir = options.outDir || path.join(EXT_ROOT, ".output", `${target}-mv3`);
  const version = options.version || getProjectVersion();

  try {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });

    await bundle(path.join(EXT_ROOT, "entrypoints/background.ts"), outDir, "background.js");
    await bundle(path.join(EXT_ROOT, "entrypoints/popup/main.ts"), outDir, "popup.js");

    const popupHtml = fs
      .readFileSync(path.join(EXT_ROOT, "entrypoints/popup/index.html"), "utf-8")
      .replace(/src=["']\.\/main\.ts["']/, 'src="./popup.js"');
    fs.writeFileSync(path.join(outDir, "popup.html"), popupHtml, "utf-8");
    fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(buildManifest(target, version), null, 2), "utf-8");

    let zipPath: string | undefined;
    let versionedZipPath: string | undefined;
    if (options.zip) {
      const parentDir = path.dirname(outDir);
      zipPath = path.join(parentDir, `convolink-companion-${target}.zip`);
      versionedZipPath = path.join(parentDir, `convolink-companion-${target}-v${version}.zip`);
      for (const archive of [zipPath, versionedZipPath]) {
        if (fs.existsSync(archive)) fs.unlinkSync(archive);
      }
      const zipProc = Bun.spawnSync(["zip", "-r", "-q", zipPath, "."], { cwd: outDir });
      if (zipProc.exitCode !== 0) {
        return { success: false, outDir, error: `Zip creation failed: ${zipProc.stderr.toString()}` };
      }
      fs.copyFileSync(zipPath, versionedZipPath);
    }

    return { success: true, outDir, zipPath, versionedZipPath, version };
  } catch (error) {
    return { success: false, outDir, error: (error as Error).message };
  }
}

if (import.meta.main) {
  const zip = !process.argv.includes("--no-zip");
  const targetArg = process.argv.find((arg) => arg.startsWith("--target="));
  const target = (targetArg?.split("=")[1] ?? "all") as BuildOptions["target"];
  const version = getProjectVersion();
  const targets: Array<"chrome" | "firefox"> =
    target === "firefox" ? ["firefox"] : target === "chrome" ? ["chrome"] : ["chrome", "firefox"];

  console.log(`📦 Building ConvoLink Companion Extensions (v${version})...`);
  for (const current of targets) {
    const result = await buildExtension({ target: current, zip, version });
    if (!result.success) {
      console.error(`❌ [${current.toUpperCase()}] ${result.error}`);
      process.exit(1);
    }
    console.log(`✅ [${current.toUpperCase()}] ${result.outDir}`);
    if (result.zipPath) console.log(`   📦 ${result.zipPath}`);
  }
}
