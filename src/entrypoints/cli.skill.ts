import fs from "node:fs";
import path from "node:path";

/**
 * Harness-specific destinations. Only layouts that are documented and stable are
 * listed; anything else goes through `--dir` so we never guess a path into a
 * tool we cannot verify.
 */
export const SKILL_TARGETS = {
  opencode: ".opencode/skills/convolink/SKILL.md",
  claude: ".claude/skills/convolink/SKILL.md",
  cursor: ".cursor/rules/convolink.mdc",
  codex: ".codex/skills/convolink/SKILL.md",
  antigravity: ".agents/skills/convolink/SKILL.md",
} as const;

export type SkillHarness = keyof typeof SKILL_TARGETS;

export interface SkillInstallDeps {
  readonly readSource?: () => string;
}

const SKILL_RELATIVE_PATH = path.join("skills", "convolink", "SKILL.md");
const EXIT_CONFIG = 2;
const EXIT_NEEDS_FORCE = 4;

function readBundledSkill(): string {
  return fs.readFileSync(path.resolve(import.meta.dir, "..", "..", SKILL_RELATIVE_PATH), "utf-8");
}

function valueOf(args: readonly string[], flag: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index !== -1 && index + 1 < args.length ? args[index + 1] : undefined;
}

function isHarness(value: string): value is SkillHarness {
  return value in SKILL_TARGETS;
}

export async function handleSkill(args: string[], deps: SkillInstallDeps = {}): Promise<number> {
  const sub = args[0] ?? "list";

  if (sub === "list") {
    console.log("\nInstallable agent skill targets:");
    for (const [harness, target] of Object.entries(SKILL_TARGETS)) {
      console.log(`  ${harness.padEnd(12)} ${target}`);
    }
    console.log("\n  convo skill install --harness <name> [--dir <project>] [--force]\n");
    return 0;
  }

  if (sub !== "install") {
    console.error(`Unknown skill command: ${sub}. Use: list, install`);
    return EXIT_CONFIG;
  }

  const harnessName = valueOf(args, "--harness") ?? valueOf(args, "-h");
  if (!harnessName || !isHarness(harnessName)) {
    console.error(`Unknown harness: ${harnessName ?? "(none)"}. Known: ${Object.keys(SKILL_TARGETS).join(", ")}`);
    return EXIT_CONFIG;
  }

  const root = path.resolve(valueOf(args, "--dir") ?? process.cwd());
  const destination = path.join(root, SKILL_TARGETS[harnessName]);
  const force = args.includes("--force");

  if (fs.existsSync(destination) && !force) {
    console.error(`Refusing to overwrite ${destination}. Re-run with --force once you have checked your edits.`);
    return EXIT_NEEDS_FORCE;
  }

  const source = (deps.readSource ?? readBundledSkill)();
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, source, "utf-8");

  console.log(`✅ Installed the ConvoLink skill for ${harnessName}: ${destination}`);
  return 0;
}
