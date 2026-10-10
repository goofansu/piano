/** Git invocations whose answers inherited state cannot redirect: no GIT_DIR/INDEX/OBJECT
 * overrides, global or system config, replace refs, optional locks, fsmonitor or pager.
 * Source-local repository config is still read by Git; callers that write (an index) pass
 * extra `-c` config to disable hooks and filters.
 */
import { isAbsolute } from "node:path";
import { type RunOptions, type RunResult, runAsync, SubprocessError } from "./Subprocess.ts";

export function hardenedEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
  return { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_OPTIONAL_LOCKS: "0", GIT_NO_REPLACE_OBJECTS: "1", LC_ALL: "C", ...extra };
}

/** A relative repository path without empty, dot or `.git` segments (embedded repositories). */
export const isSafePath = (path: string) =>
  !!path && !isAbsolute(path) && !path.split("/").some(p => !p || p === "." || p === ".." || p.toLowerCase() === ".git");

export interface HardenedGitOptions extends Pick<RunOptions, "input" | "limit" | "truncate" | "okCodes"> {
  readonly cwd: string;
  readonly config?: readonly string[];
  readonly env?: Record<string, string>;
}

/** A rejected exit becomes `Git <subcommand> failed: <stderr>`; other runner failures pass through. */
export async function hardenedGit(git: string, args: readonly string[], options: HardenedGitOptions, signal: AbortSignal): Promise<RunResult> {
  const { cwd, config = [], env, ...run } = options;
  try {
    return await runAsync({ ...run, command: git, cwd, env: hardenedEnv(env), args: ["--no-pager", "-c", "core.fsmonitor=false", ...config, ...args] }, signal);
  } catch (error) {
    if (error instanceof SubprocessError && error.reason === "exit") throw new Error(`Git ${args[0]} failed: ${error.message}`);
    throw error;
  }
}
