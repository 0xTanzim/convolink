import fs from "node:fs";
import path from "node:path";

export interface BuildDistOptions {
  readonly outDir?: string;
}

export interface BuildDistResult {
  readonly success: boolean;
  readonly outDir: string;
  readonly cliPath: string;
  readonly mcpPath: string;
  readonly error?: string;
}

const ROOT_DIR = path.resolve(import.meta.dir, "..");

export async function buildDist(options: BuildDistOptions = {}): Promise<BuildDistResult> {
  const outDir = options.outDir || path.join(ROOT_DIR, "dist");
  const cliPath = path.join(outDir, "cli.js");
  const mcpPath = path.join(outDir, "mcp.js");

  try {
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }

    // Pass 1: Standalone CLI bundle (isolated to eliminate import.meta.main in imported mcp.ts)
    const cliBuild = await Bun.build({
      entrypoints: [path.join(ROOT_DIR, "src/entrypoints/cli.ts")],
      outdir: outDir,
      naming: "cli.js",
      target: "bun",
      format: "esm",
      banner: "#!/usr/bin/env bun\n",
      minify: false,
    });

    if (!cliBuild.success) {
      const err = cliBuild.logs.map((l) => l.message).join("\n");
      return { success: false, outDir, cliPath, mcpPath, error: `CLI build failed: ${err}` };
    }

    // Pass 2: Standalone MCP stdio server bundle
    const mcpBuild = await Bun.build({
      entrypoints: [path.join(ROOT_DIR, "src/entrypoints/mcp.ts")],
      outdir: outDir,
      naming: "mcp.js",
      target: "bun",
      format: "esm",
      banner: "#!/usr/bin/env bun\n",
      minify: false,
    });

    if (!mcpBuild.success) {
      const err = mcpBuild.logs.map((l) => l.message).join("\n");
      return { success: false, outDir, cliPath, mcpPath, error: `MCP build failed: ${err}` };
    }

    fs.chmodSync(cliPath, 0o755);
    fs.chmodSync(mcpPath, 0o755);

    return { success: true, outDir, cliPath, mcpPath };
  } catch (err: unknown) {
    return {
      success: false,
      outDir,
      cliPath,
      mcpPath,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

if (import.meta.main) {
  const result = await buildDist();
  if (result.success) {
    console.log(`✅ [dist] Built standalone executables in ${result.outDir}`);
    console.log(`   - ${result.cliPath} (0o755)`);
    console.log(`   - ${result.mcpPath} (0o755)`);
  } else {
    console.error(`❌ [dist] Build failed: ${result.error}`);
    process.exit(1);
  }
}
