/**
 * New worktrees of registered folders: created through Worktrunk (INV-06) and registered under
 * their folder, as one server-owned step. A requester that leaves while Worktrunk runs cannot
 * interrupt it into a checkout left on disk but never registered (INV-02). SessionHosts and
 * WorkspaceCommands both create worktrees here, so this module sits below them and needs only
 * the registry and Worktrees.
 */
import { Context, Effect, Fiber, Layer } from "effect";
import { Registry } from "./Registry.ts";
import { createWorktree, WorktreeError } from "./Worktrees.ts";

/** A worktree created and registered under `folder`. */
export interface CreatedWorktree {
  readonly folder: string;
  readonly path: string;
  readonly branch: string;
  readonly baseBranch: string;
  readonly hooks: "enabled" | "skipped";
}

export class FolderWorktrees extends Context.Service<
  FolderWorktrees,
  {
    /**
     * Create a new branch's worktree from a registered folder and register it. The work belongs
     * to the server: interrupting the caller leaves it running to completion. A failure after
     * Worktrunk ran, its own or the registry's, is a WorktreeError marked `unconfirmed`, since a
     * checkout may exist anyway; any earlier refusal created nothing.
     */
    readonly create: (
      folder: string,
      branch: string,
      options: { readonly hooks?: boolean },
    ) => Effect.Effect<CreatedWorktree, WorktreeError>;
  }
>()("piano/FolderWorktrees") {}

export const FolderWorktreesLive = Layer.effect(
  FolderWorktrees,
  Effect.gen(function* () {
    const registry = yield* Registry;
    const layerScope = yield* Effect.scope;

    const create = Effect.fn("FolderWorktrees.create")(
      function* (folder: string, branch: string, options: { readonly hooks?: boolean }) {
        yield* registry
          .requireFolder(folder)
          .pipe(Effect.mapError((e) => new WorktreeError({ detail: e.detail })));
        const created = yield* createWorktree(folder, branch.trim(), { hooks: options.hooks });
        yield* registry
          .addWorktree({ folder, path: created.path, branch: created.branch })
          .pipe(
            Effect.mapError(
              (e) =>
                new WorktreeError({ detail: `${e.detail} ${created.path}`, unconfirmed: true }),
            ),
          );
        return { folder, ...created };
      },
      (work) => work.pipe(Effect.forkIn(layerScope), Effect.flatMap(Fiber.join)),
    );
    return FolderWorktrees.of({ create });
  }),
);
