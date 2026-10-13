/**
 * Workspace commands: the domain steps behind the browser's requests to discover and add
 * worktrees and to trust a folder. Registry holds references only (INV-01); Worktrees owns Git
 * and Worktrunk; Pi's trust store owns trust. Sessions belong to SessionHosts.
 */
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
import { createWorktree, listWorktrees, WorktreeError } from "./Worktrees.ts";

type ReadyWorktree = Extract<WorktreeResult, { status: "ready" }>;

export interface TrustDecision {
  readonly cwd: string;
  readonly trust: ProjectTrust;
  readonly catalog: ModelCatalog;
  readonly notice: string;
}

export class WorkspaceCommands extends Context.Service<
  WorkspaceCommands,
  {
    /** Git's worktrees for a registered folder; an unregistered one is an error discovery, not a failure. */
    readonly discoverWorktrees: (folder: string) => Effect.Effect<WorktreeDiscovery>;
    /**
     * Register an existing checkout of a registered folder. Like `createWorktree`, it answers every
     * outcome as a result, failures included, then has the sidebar rediscover (INV-06).
     */
    readonly addWorktree: (folder: string, path: string) => Effect.Effect<WorktreeResult>;
    /**
     * Create a new branch checkout through Worktrunk and register it. A failed result is
     * `unconfirmed` when a checkout may exist anyway: Worktrunk ran, or something failed after it.
     */
    readonly createWorktree: (
      folder: string,
      branch: string,
      options: { readonly hooks?: boolean },
    ) => Effect.Effect<WorktreeResult>;
    /**
     * Save Pi's trust decision for a directory. Every client re-probes its models and the sidebar
     * shows the new trust; returns what Pi will now do there and the notice to show the requester.
     */
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
    /**
     * A worktree mutation's complete answer. Failures become error results; only an expected
     * WorktreeError can confirm that nothing ran. Then rediscover rather than retry: a failure may
     * have left a checkout behind.
     */
    const settled = <E>(work: Effect.Effect<ReadyWorktree, E>): Effect.Effect<WorktreeResult> =>
      work.pipe(
        Effect.catchCause((cause) => {
          if (Cause.hasInterruptsOnly(cause)) return Effect.interrupt;
          const error = Cause.squash(cause);
          const detail = errorText(error);
          return Effect.logWarning(`worktree request failed: ${detail}`).pipe(
            Effect.as<WorktreeResult>({
              status: "error",
              detail,
              unconfirmed: !(error instanceof WorktreeError) || error.unconfirmed === true,
            }),
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
        // Pi's resources for this directory, and so its models and commands, change for sessions
        // started from now. DirectoryFacts announces it; every client and the sidebar hear it there.
        const decision = yield* facts.setTrust(path, trusted);
        const notice = trusted
          ? "Trusted. Sessions started from now load this folder's Pi settings and skills."
          : "Untrusted. Sessions started from now skip this folder's Pi settings and skills.";
        return { ...decision, notice };
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

      createWorktree: Effect.fn("WorkspaceCommands.createWorktree")(function* (
        folder,
        branch,
        options,
      ) {
        yield* registered(folder);
        const w = yield* createWorktree(folder, branch.trim(), { hooks: options.hooks });
        return yield* record({
          status: "ready",
          folder,
          path: w.path,
          branch: w.branch,
          creation: { baseBranch: w.baseBranch, hooks: w.hooks },
        });
      }, settled),
    });
  }),
);
