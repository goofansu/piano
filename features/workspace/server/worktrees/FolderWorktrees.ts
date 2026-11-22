import { Context, Data, type Effect } from "effect";

export class WorktreeError extends Data.TaggedError("WorktreeError")<{
  readonly detail: string;
  readonly unconfirmed?: boolean;
}> {}

export interface CreatedWorktree {
  readonly folder: string;
  readonly path: string;
  readonly branch: string;
  readonly baseBranch: string;
}

export class FolderWorktrees extends Context.Service<
  FolderWorktrees,
  {
    readonly owner: (path: string) => Effect.Effect<
      {
        readonly root: string;
        readonly main: string;
        readonly branch: string | null;
      } | null,
      WorktreeError
    >;
    readonly mainCheckout: (path: string) => Effect.Effect<string | null, WorktreeError>;
    readonly create: (
      folder: string,
      branch: string,
    ) => Effect.Effect<CreatedWorktree, WorktreeError>;
  }
>()("piano/FolderWorktrees") {}
