/**
 * The selected session's Changes: the checkout it inspects (its own), the comparison it reads
 * (the session's saved scope, else Uncommitted) and the identities that name a branch's
 * target: the session's pull request branches as GitHub last reported them, and the base branch
 * Worktrunk reported when Piano created the worktree. Git owns the facts through
 * WorkspaceChanges; the registry holds only the session's choice (INV-01).
 */
import { Context, Effect, Layer } from "effect";
import type { ChangesScope, WorkspaceChanges as Observation, Workspace } from "../shared/wire.ts";
import type { TargetHints } from "./ComparisonBase.ts";
import { Registry, type RegistryError, type SessionEntry } from "./Registry.ts";
import { WorkspaceChanges } from "./WorkspaceChanges.ts";

export interface SessionChangesOptions {
  /** The comparison for this read; without it, the session's saved scope, else Uncommitted. */
  readonly scope?: ChangesScope;
  /** One file's fresh patch instead of the whole change. */
  readonly path?: string;
}

/** Callers pass the workspace and session entry the router resolved by ID. */
export class SessionChanges extends Context.Service<
  SessionChanges,
  {
    readonly read: (
      workspace: Workspace,
      session: SessionEntry,
      options?: SessionChangesOptions,
    ) => Effect.Effect<Observation>;
    /** Save the session's scope (`null` restores the Uncommitted default) and read with it. */
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

    /** The identities Piano holds for the session's checkout. */
    const hintsFor = Effect.fn("SessionChanges.hintsFor")(function* (session: SessionEntry) {
      const data = yield* registry.get;
      const worktree = data.worktrees.find((w) => w.path === session.cwd);
      const link = session.pullRequest;
      const hints: TargetHints = {
        ...(link?.head && link.base ? { pullRequest: link } : {}),
        ...(worktree?.baseBranch ? { worktreeBase: worktree.baseBranch } : {}),
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
