import { ProjectConfigAdapter } from "../adapters/config/project-config.adapter.js";
import { ConvoError } from "../core/errors/convo-error.js";
import { resolveSetup, type ResolvedSetup, type SetupOverrides, type SetupResolution } from "../core/services/setup/precedence.js";

/** Reads both config layers once and resolves them through the single resolver. */
export async function loadResolution(
  overrides: SetupOverrides = {},
  workDir?: string,
): Promise<SetupResolution> {
  const effectiveWorkDir =
    workDir ??
    process.env.CONVOLINK_WORKSPACE ??
    (process.env.PWD && process.env.PWD !== process.env.HOME ? process.env.PWD : undefined);
  const store = new ProjectConfigAdapter();
  const [project, user] = await Promise.all([store.load(effectiveWorkDir), store.loadUser()]);
  const invalid = [project, user].find((result) => result.status === "invalid");
  if (invalid) {
    return {
      ok: false,
      error: {
        code: "configuration-invalid",
        message: invalid.problem ?? `${invalid.path} is invalid`,
        remediation: "Fix or remove that file, then run `convo setup`.",
      },
    };
  }
  return resolveSetup({ overrides, project: project.config, user: user.config, env: process.env });
}

export function requireResolution(result: SetupResolution): ResolvedSetup {
  if (result.ok) return result.value;
  throw new ConvoError(result.error.code, result.error.message, result.error.remediation);
}
