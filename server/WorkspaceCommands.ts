import { Context, Effect, Layer } from "effect";
import type { ModelCatalog, ProjectTrust } from "../shared/wire.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import type { ProjectTrustError } from "./ProjectTrust.ts";

export interface TrustDecision {
  readonly cwd: string;
  readonly trust: ProjectTrust;
  readonly catalog: ModelCatalog;
  readonly notice: string;
  readonly level: "success" | "warning";
}

export class WorkspaceCommands extends Context.Service<
  WorkspaceCommands,
  {
    readonly setTrust: (
      path: string,
      trusted: boolean,
    ) => Effect.Effect<TrustDecision, ProjectTrustError>;
  }
>()("piano/WorkspaceCommands") {}

export const WorkspaceCommandsLive = Layer.effect(
  WorkspaceCommands,
  Effect.gen(function* () {
    const facts = yield* DirectoryFacts;
    return WorkspaceCommands.of({
      setTrust: Effect.fn("WorkspaceCommands.setTrust")(function* (path, trusted) {
        const decision = yield* facts.setTrust(path, trusted);
        if (decision.trust.trusted !== trusted)
          return {
            ...decision,
            level: "warning" as const,
            notice: `Pi changed this folder back to ${decision.trust.trusted ? "trusted" : "untrusted"} while reloading. Check your Pi extensions before trying again.`,
          };
        const notice = trusted
          ? "Trusted. Sessions started from now load this folder's Pi settings and skills."
          : "Untrusted. Sessions started from now skip this folder's Pi settings and skills.";
        return { ...decision, notice, level: "success" as const };
      }),
    });
  }),
);
