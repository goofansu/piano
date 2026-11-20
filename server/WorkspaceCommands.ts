import { Cause, Context, Effect, Layer } from "effect";
import type {
  ModelCatalog,
  ProjectTrust,
  WorktreeDiscovery,
  WorktreeResult,
} from "../shared/wire.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import { errorText } from "./ErrorText.ts";
import type { ProjectTrustError } from "./ProjectTrust.ts";
import { Registry } from "./Registry.ts";
import { SidebarView } from "./SidebarView.ts";
import { listWorktrees, WorktreeError } from "./Worktrees.ts";

type ReadyWorktree = Extract<WorktreeResult, { status: "ready" }>;

export const worktreeFailure = (error: unknown): Extract<WorktreeResult, { status: "error" }> => ({
  status: "error",
  detail: errorText(error),
  unconfirmed: !(error instanceof WorktreeError) || error.unconfirmed === true,
});

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
    readonly discoverWorktrees: (folder: string) => Effect.Effect<WorktreeDiscovery>;
    readonly addWorktree: (folder: string, path: string) => Effect.Effect<WorktreeResult>;
    readonly setTrust: (
      path: string,
      trusted: boolean,
    ) => Effect.Effect<TrustDecision, ProjectTrustError>;
  }
>()("piano/WorkspaceCommands") {}

export const WorkspaceCommandsLive = Layer.effect(
  WorkspaceCommands,
  Effect.gen(function* () {
    const registry = yield* Registry;
    const facts = yield* DirectoryFacts;
    const sidebar = yield* SidebarView;

    const registered = (folder: string) =>
      registry
        .requireFolder(folder)
        .pipe(
          Effect.catchTag("RegistryLookupError", (e) =>
            Effect.fail(new WorktreeError({ detail: e.detail })),
          ),
        );
    const record = Effect.fn("WorkspaceCommands.record")(function* (result: ReadyWorktree) {
      if (result.path !== result.folder)
        yield* registry.addWorktree({
          folder: result.folder,
          path: result.path,
          branch: result.branch ?? "",
        });
      return result;
    });
    const settled = <E>(work: Effect.Effect<ReadyWorktree, E>): Effect.Effect<WorktreeResult> =>
      work.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
          const result = worktreeFailure(Cause.squash(cause));
          return Effect.logWarning(`worktree request failed: ${result.detail}`).pipe(
            Effect.as<WorktreeResult>(result),
          );
        }),
        Effect.ensuring(sidebar.refresh),
      );
    return WorkspaceCommands.of({
      discoverWorktrees: (folder) =>
        registry.requireFolder(folder).pipe(
          Effect.andThen(listWorktrees(folder)),
          Effect.catchTag("RegistryLookupError", (e) =>
            Effect.succeed({
              status: "error" as const,
              observedAt: new Date().toISOString(),
              detail: e.detail,
            }),
          ),
        ),

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

      addWorktree: Effect.fn("WorkspaceCommands.addWorktree")(function* (folder, path) {
        yield* registered(folder);
        const discovery = yield* listWorktrees(folder);
        if (discovery.status !== "ready")
          return yield* new WorktreeError({
            detail: discovery.status === "error" ? discovery.detail : "This folder is non-Git.",
          });
        const w = discovery.worktrees.find((w) => w.path === path);
        if (!w || w.prunable)
          return yield* new WorktreeError({
            detail:
              "This checkout is absent or unavailable. Refresh discovery and inspect it before selecting.",
          });
        return yield* record({ status: "ready", folder, path: w.path, branch: w.branch });
      }, settled),
    });
  }),
);
