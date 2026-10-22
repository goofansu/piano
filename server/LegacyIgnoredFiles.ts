/**
 * The Files answer for browser tabs built before 1b9e6b6, which post `/api/workspace/files/ignored`
 * and decode `LegacyWorkspaceIgnoredFiles` (shared/http.ts `LegacyEndpoints`, which says when this
 * can go). It is `WorkspaceChanges.written` regrouped, so the verdicts have one implementation.
 */
import { Effect } from "effect";
import type { LegacyWorkspaceIgnoredFiles } from "../shared/http.ts";
import type { Workspace, WrittenFile } from "../shared/wire.ts";
import { projectDisplay } from "./DisplayProjection.ts";
import { exists, WorkspaceChanges } from "./WorkspaceChanges.ts";

type Inside = Exclude<WrittenFile, { verdict: "outside" }>;

/**
 * The old grouping: `outside` as sent, duplicates included; every other path once, in the order
 * first sent, in `inside` with its name at the same index in `placed`, and in `ignored` and
 * `missing` as they apply. The old answer checked existence before Git, so an ignored path that no
 * longer exists is missing too: `written` answers such a path "ignored", and it is looked up here.
 */
async function regroup(
  workspace: Workspace,
  files: readonly WrittenFile[],
): Promise<LegacyWorkspaceIgnoredFiles["result"]> {
  const inside = new Map<string, Inside>();
  const outside: string[] = [];
  for (const file of files)
    if (file.verdict === "outside") outside.push(file.path);
    else inside.set(file.path, file);
  const ignored: string[] = [];
  const missing: string[] = [];
  try {
    for (const [path, file] of inside) {
      if (file.verdict === "ignored") ignored.push(path);
      if (
        file.verdict === "missing" ||
        (file.verdict === "ignored" && !(await exists(workspace, path)))
      )
        missing.push(path);
    }
  } catch (error) {
    // As the old answer reported a failed existence check: the whole read failed.
    return { status: "error", detail: error instanceof Error ? error.message : String(error) };
  }
  return {
    status: "ready",
    ignored,
    outside,
    missing,
    inside: [...inside.keys()],
    placed: [...inside.values()].map((file) => file.placed),
  };
}

export const legacyIgnoredFiles = Effect.fn("LegacyIgnoredFiles.legacyIgnoredFiles")(function* (
  workspace: Workspace,
  paths: readonly string[],
): Effect.fn.Return<LegacyWorkspaceIgnoredFiles, never, WorkspaceChanges> {
  const changes = yield* WorkspaceChanges;
  const answer = yield* changes.written(workspace, paths);
  if (answer.result.status !== "ready") return { ...answer, result: answer.result };
  const { files } = answer.result;
  return { ...answer, result: yield* Effect.promise(() => regroup(answer.workspace, files)) };
});

/**
 * The display projection as the old server applied it: the path arrays were identity fields, so
 * they leave verbatim (a redacted path names nothing), and everything else — the workspace, an
 * error's detail — is projected. Scoped to this answer, so those key names stay display text
 * everywhere else.
 */
export const projectLegacyIgnoredFiles = (
  answer: LegacyWorkspaceIgnoredFiles,
): LegacyWorkspaceIgnoredFiles => {
  const projected = projectDisplay(answer);
  return answer.result.status === "ready" ? { ...projected, result: answer.result } : projected;
};
