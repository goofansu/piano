import { Context, Data, type Effect, type Scope, type Stream } from "effect";
import type { ModelCatalog, ProjectTrust, SlashCommand } from "../../shared/wire.ts";

export class ProjectTrustError extends Data.TaggedError("ProjectTrustError")<{
  readonly detail: string;
}> {}

export interface DirectoryTrust {
  readonly cwd: string;
  readonly trust: ProjectTrust;
}

export class DirectoryCommandsError extends Data.TaggedError("DirectoryCommandsError")<{
  readonly detail: string;
}> {}

export class DirectoryFacts extends Context.Service<
  DirectoryFacts,
  {
    readonly trust: (raw: string) => Effect.Effect<DirectoryTrust>;
    readonly catalog: (
      raw: string,
      options?: { readonly refresh?: boolean },
    ) => Effect.Effect<ModelCatalog>;
    readonly global: Effect.Effect<ModelCatalog>;
    readonly commands: (
      raw: string,
    ) => Effect.Effect<ReadonlyArray<SlashCommand>, DirectoryCommandsError>;
    readonly setTrust: (
      raw: string,
      trusted: boolean,
    ) => Effect.Effect<DirectoryTrust & { readonly catalog: ModelCatalog }, ProjectTrustError>;
    readonly invalidate: Effect.Effect<void>;
    readonly changes: Effect.Effect<Stream.Stream<void>, never, Scope.Scope>;
  }
>()("piano/DirectoryFacts") {}
