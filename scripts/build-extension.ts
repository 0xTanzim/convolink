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

export function getProjectVersion(): string {
  try {
    const pkgPath = path.join(ROOT_DIR, "package.json");
    if (fs.existsSync(pkgPath)) {
      const data = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (data.version) return data.version;
    }
  } catch {}
  return "1.0.0";
}

export async function buildExtension(options: BuildOptions): Promise<BuildResult> {
  const target = options.target === "firefox" ? "firefox" : "chrome";
  const outDir = options.outDir || path.join(EXT_ROOT, ".output", `${target}-mv3`);
  const version = options.version || getProjectVersion();

  try {
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // 1. Build background service worker / script
    const bgEntry = path.join(EXT_ROOT, "entrypoints/background.ts");
    const bgBuild = await Bun.build({
      entrypoints: [bgEntry],
      outdir: outDir,
      naming: "background.js",
      target: "browser",
      minify: false,
    });

    if (!bgBuild.success) {
      const err = bgBuild.logs.map((l) => l.message).join("\n");
      return { success: false, outDir, error: `Background build failed: ${err}` };
    }

    // 2. Build popup script
    const popupEntry = path.join(EXT_ROOT, "entrypoints/popup/main.ts");
    const popupBuild = await Bun.build({
      entrypoints: [popupEntry],
      outdir: outDir,
      naming: "popup.js",
      target: "browser",
      minify: false,
    });

    if (!popupBuild.success) {
      const err = popupBuild.logs.map((l) => l.message).join("\n");
      return { success: false, outDir, error: `Popup build failed: ${err}` };
    }

    // 3. Process and write popup HTML
    const popupHtmlSrc = path.join(EXT_ROOT, "entrypoints/popup/index.html");
    let htmlContent = fs.readFileSync(popupHtmlSrc, "utf-8");
    htmlContent = htmlContent.replace(/src=["']\.\/main\.ts["']/, 'src="./popup.js"');
    fs.writeFileSync(path.join(outDir, "popup.html"), htmlContent, "utf-8");

    // 4. Generate Target Manifest with dynamic versioning
    const manifest = {
      manifest_version: 3,
      name: "ConvoLink Companion",
      version,
      description: "Zero-flag intelligence & context bridge for ConvoLink and local AI agents.",
      permissions: ["tabs", "storage", "alarms", "scripting"],
      host_permissions: [
        "https://chatgpt.com/*",
        "https://chat.deepseek.com/*",
        "https://gemini.google.com/*",
        "https://claude.ai/*",
      ],
      background:
        target === "firefox"
          ? { scripts: ["background.js"], type: "module" }
          : { service_worker: "background.js", type: "module" },
      action: {
        default_popup: "popup.html",
        default_title: "ConvoLink Companion",
      },
      browser_specific_settings:
        target === "firefox"
          ? { gecko: { id: "companion@convolink.local", strict_min_version: "109.0" } }
          : undefined,
    };

    fs.writeFileSync(
      path.join(outDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
      "utf-8",
    );

    // 5. Package zip if requested
    let zipPath: string | undefined;
    let versionedZipPath: string | undefined;
    if (options.zip) {
      const parentDir = path.dirname(outDir);
      zipPath = path.join(parentDir, `convolink-companion-${target}.zip`);
      versionedZipPath = path.join(parentDir, `convolink-companion-${target}-v${version}.zip`);

      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
      if (fs.existsSync(versionedZipPath)) fs.unlinkSync(versionedZipPath);

      const zipProc = Bun.spawnSync(["zip", "-r", "-q", zipPath, "."], {
        cwd: outDir,
      });

      if (zipProc.exitCode !== 0) {
        return {
          success: false,
          outDir,
          error: `Zip creation failed: ${zipProc.stderr.toString()}`,
        };
      }

      fs.copyFileSync(zipPath, versionedZipPath);
    }

    return { success: true, outDir, zipPath, versionedZipPath, version };
  } catch (err: unknown) {
    return { success: false, outDir, error: (err as Error).message };
  }
}

// CLI Runner
if (import.meta.main) {
  const isZip = !process.argv.includes("--no-zip");
  const targetArg = process.argv.find((a) => a.startsWith("--target="));
  const target = targetArg ? targetArg.split("=")[1] : "all";
  const version = getProjectVersion();

  console.log(`📦 Building ConvoLink Companion Extensions (v${version})...`);

  const targets: ("chrome" | "firefox")[] =
    target === "firefox" ? ["firefox"] : target === "chrome" ? ["chrome"] : ["chrome", "firefox"];

  for (const t of targets) {
    const res = await buildExtension({ target: t, zip: isZip, version });
    if (res.success) {
      console.log(`✅ [${t.toUpperCase()}] Built -> ${res.outDir}`);
      if (res.zipPath) console.log(`   📦 Generic Archive    -> ${res.zipPath}`);
      if (res.versionedZipPath) console.log(`   📦 Versioned Archive  -> ${res.versionedZipPath}`);
    } else {
      console.error(`❌ [${t.toUpperCase()}] Failed:`, res.error);
      process.exit(1);
    }
  }

  // Also sync Chrome build into root unpacked extension directory for instant local loading
  const rootRes = await buildExtension({ target: "chrome", outDir: EXT_ROOT, zip: false, version });
  if (rootRes.success) {
    console.log(`✅ [ROOT UNPACKED] Synced ${EXT_ROOT} for instant 'Load unpacked' usage.`);
  }
}
