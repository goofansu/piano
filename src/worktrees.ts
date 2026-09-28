/**
 * Worktrunk (`wt`) integration: list a project's worktrees and create new ones.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface Worktree {
  branch: string;
  path: string;
  main: boolean;
}

interface WtListItem {
  branch?: string;
  worktree?: { path: string; main?: boolean };
}

export async function listWorktrees(project: string): Promise<Worktree[]> {
  try {
    const { stdout } = await run("wt", ["-C", project, "list", "--format", "json"], {
      maxBuffer: 8 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as { items?: WtListItem[] };
    const items = (parsed.items ?? [])
      .filter((i): i is WtListItem & { worktree: { path: string; main?: boolean } } => !!i.worktree)
      .map((i) => ({
        branch: i.branch ?? "",
        path: i.worktree.path,
        main: !!i.worktree.main,
      }));
    if (!items.some((w) => w.path === project)) {
      items.unshift({ branch: "", path: project, main: true });
    }
    return items.sort((a, b) => Number(b.main) - Number(a.main) || a.branch.localeCompare(b.branch));
  } catch {
    // Not a git repo, or wt is unavailable: the project root is the only "worktree".
    return [{ branch: "", path: project, main: true }];
  }
}

function firstJsonLine(stdout: string): Record<string, unknown> | undefined {
  for (const line of stdout.split("\n")) {
    const t = line.trim();
    if (t.startsWith("{")) {
      try {
        return JSON.parse(t) as Record<string, unknown>;
      } catch {
        /* keep looking */
      }
    }
  }
  return undefined;
}

export async function createWorktree(
  project: string,
  branch: string,
  options: { hooks?: boolean } = {},
): Promise<Worktree> {
  const base = ["-C", project, "switch"];
  const tail = ["--format", "json", "--no-cd", "-y", ...(options.hooks ? [] : ["--no-hooks"])];
  const attempt = async (create: boolean) =>
    run("wt", [...base, ...(create ? ["--create"] : []), branch, ...tail], {
      maxBuffer: 8 * 1024 * 1024,
    });

  let stdout: string;
  try {
    ({ stdout } = await attempt(true));
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? err);
    if (/already exists/i.test(stderr)) {
      // Branch exists without a worktree: switch (creating the worktree) instead.
      ({ stdout } = await attempt(false));
    } else {
      throw new Error(stderr.trim() || "wt switch failed");
    }
  }
  const result = firstJsonLine(stdout);
  const path = result?.path;
  if (typeof path !== "string") throw new Error(`wt returned no worktree path:\n${stdout}`);
  return { branch: String(result?.branch ?? branch), path, main: false };
}
