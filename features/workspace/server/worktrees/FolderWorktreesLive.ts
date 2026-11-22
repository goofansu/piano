import { Effect, Fiber, Layer } from "effect";
import { Registry } from "../../../../server/shared/registry/Registry.ts";
import { gitText, worktreeInstance } from "../GitCheckout.ts";
import { FolderWorktrees, WorktreeError } from "./FolderWorktrees.ts";
import { createWorktree, mainCheckoutOf, worktreeOwner } from "./Worktrees.ts";

export const FolderWorktreesLive = Layer.effect(
  FolderWorktrees,
  Effect.gen(function* () {
    const registry = yield* Registry;
    const layerScope = yield* Effect.scope;

    const create = Effect.fn("FolderWorktrees.create")(
      function* (folder: string, branch: string) {
        yield* registry
          .requireFolder(folder)
          .pipe(Effect.mapError((e) => new WorktreeError({ detail: e.detail })));
        const created = yield* createWorktree(folder, branch.trim());
        const unconfirmed = (e: { readonly detail: string }) =>
          new WorktreeError({ detail: `${e.detail} ${created.path}`, unconfirmed: true });
        const commit = yield* gitText(created.path, [
          "rev-parse",
          "--verify",
          "HEAD^{commit}",
        ]).pipe(
          Effect.map((out) => out.trim()),
          Effect.mapError(unconfirmed),
        );
        const gitDir = yield* gitText(created.path, ["rev-parse", "--absolute-git-dir"]).pipe(
          Effect.map((out) => out.trim()),
          Effect.mapError(unconfirmed),
        );
        const instance = yield* Effect.tryPromise({
          try: () => worktreeInstance(gitDir),
          catch: (error) =>
            unconfirmed({ detail: error instanceof Error ? error.message : String(error) }),
        });
        yield* registry
          .recordCreatedWorktree({
            folder,
            path: created.path,
            branch: created.branch,
            baseBranch: created.baseBranch,
            commit,
            instance,
          })
          .pipe(Effect.mapError(unconfirmed));
        return { folder, ...created };
      },
      (work) => work.pipe(Effect.forkIn(layerScope), Effect.flatMap(Fiber.join)),
    );
    return FolderWorktrees.of({ create, mainCheckout: mainCheckoutOf, owner: worktreeOwner });
  }),
);
