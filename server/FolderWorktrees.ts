import { Context, Effect, Fiber, Layer } from "effect";
import { Registry } from "./Registry.ts";
import { createWorktree, WorktreeError } from "./Worktrees.ts";

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
          .addWorktree({
            folder,
            path: created.path,
            branch: created.branch,
            baseBranch: created.baseBranch,
          })
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
