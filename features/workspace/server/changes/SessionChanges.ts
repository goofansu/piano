import { Context, Effect, Layer } from "effect";
import {
  Registry,
  type RegistryError,
  type SessionEntry,
} from "../../../../server/shared/registry/Registry.ts";
import type { ChangesScope, Workspace } from "../../../../shared/wire.ts";
import type { WorkspaceChanges as Observation } from "../../contracts/changes/http.ts";
import { pullRequestBranches } from "../../contracts/pull-requests/pullRequestBranches.ts";
import type { TargetHints } from "./ComparisonBase.ts";
import { WorkspaceChanges } from "./WorkspaceChanges.ts";

export interface SessionChangesOptions {
  readonly scope?: ChangesScope;
  readonly path?: string;
}

export class SessionChanges extends Context.Service<
  SessionChanges,
  {
    readonly read: (
      workspace: Workspace,
      session: SessionEntry,
      options?: SessionChangesOptions,
    ) => Effect.Effect<Observation>;
    readonly setScope: (
      workspace: Workspace,
      session: SessionEntry,
      scope: ChangesScope | null,
    ) => Effect.Effect<Observation, RegistryError>;
  }
>()("piano/SessionChanges") {}

export const SessionChangesLive = Layer.effect(
  SessionChanges,
  Effect.gen(function* () {
    const registry = yield* Registry;
    const changes = yield* WorkspaceChanges;

    const hintsFor = Effect.fn("SessionChanges.hintsFor")(function* (session: SessionEntry) {
      const data = yield* registry.get;
      const worktree = data.worktrees.find((w) => w.path === session.cwd);
      const link = session.pullRequest;
      const hints: TargetHints = {
        ...(link ? { pullRequest: pullRequestBranches(link) } : {}),
        ...(worktree?.created
          ? {
              worktreeBase: {
                branch: worktree.created.branch,
                base: worktree.created.baseBranch,
                ...(worktree.created.commit ? { commit: worktree.created.commit } : {}),
                ...(worktree.created.instance ? { instance: worktree.created.instance } : {}),
              },
            }
          : {}),
      };
      return hints;
    });

    const read = Effect.fn("SessionChanges.read")(function* (
      workspace: Workspace,
      session: SessionEntry,
      options: SessionChangesOptions = {},
    ) {
      const hints = yield* hintsFor(session);
      return yield* changes.preview(workspace, {
        scope: options.scope ?? session.changesScope,
        hints,
        path: options.path,
      });
    });

    return SessionChanges.of({
      read,
      setScope: Effect.fn("SessionChanges.setScope")(function* (workspace, session, scope) {
        yield* registry.setSessionChangesScope(session.cwd, session.sessionId, scope ?? undefined);
        return yield* read(workspace, { ...session, changesScope: scope ?? undefined });
      }),
    });
  }),
);
