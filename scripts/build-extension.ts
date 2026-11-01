import fs from "node:fs";
import path from "node:path";

export interface BuildOptions {
  readonly target: "chrome" | "firefox" | "all";
  readonly outDir?: string;
  readonly zip?: boolean;
}

export interface BuildResult {
  readonly success: boolean;
  readonly outDir: string;
  readonly zipPath?: string;
  readonly error?: string;
}

const EXT_ROOT = path.resolve(import.meta.dir, "../extensions/convolink-companion");

export async function buildExtension(options: BuildOptions): Promise<BuildResult> {
  const target = options.target === "firefox" ? "firefox" : "chrome";
  const outDir = options.outDir || path.join(EXT_ROOT, ".output", `${target}-mv3`);

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

    // 4. Generate Target Manifest
    const manifest = {
      manifest_version: 3,
      name: "ConvoLink Companion",
      version: "1.0.0",
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
    if (options.zip) {
      zipPath = path.join(path.dirname(outDir), `convolink-companion-${target}.zip`);
      if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

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
    }

    return { success: true, outDir, zipPath };
  } catch (err: unknown) {
    return { success: false, outDir, error: (err as Error).message };
  }
}

// CLI Runner
if (import.meta.main) {
  const isZip = !process.argv.includes("--no-zip");
  const targetArg = process.argv.find((a) => a.startsWith("--target="));
  const target = targetArg ? targetArg.split("=")[1] : "all";

  console.log("📦 Building ConvoLink Companion Extensions...");

  const targets: ("chrome" | "firefox")[] =
    target === "firefox" ? ["firefox"] : target === "chrome" ? ["chrome"] : ["chrome", "firefox"];

  for (const t of targets) {
    const res = await buildExtension({ target: t, zip: isZip });
    if (res.success) {
      console.log(`✅ [${t.toUpperCase()}] Built -> ${res.outDir}`);
      if (res.zipPath) console.log(`   📦 Package -> ${res.zipPath}`);
    } else {
      console.error(`❌ [${t.toUpperCase()}] Failed:`, res.error);
      process.exit(1);
    }
  }

  // Also sync Chrome build into root unpacked extension directory for easy local loading
  const rootRes = await buildExtension({ target: "chrome", outDir: EXT_ROOT, zip: false });
  if (rootRes.success) {
    console.log(`✅ [ROOT UNPACKED] Updated ${EXT_ROOT} for instant 'Load unpacked' usage.`);
  }
}
