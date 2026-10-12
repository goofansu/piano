/**
 * Workspace commands: the domain steps behind the browser's requests to discover and add
 * worktrees and to trust a folder. Registry holds references only (INV-01); Worktrees owns Git
 * and Worktrunk; Pi's trust store owns trust. Sessions belong to SessionHosts.
 */
import { Context, Effect, Layer } from "effect";
import type {
  ModelCatalog,
  ProjectTrust,
  WorktreeDiscovery,
  WorktreeResult,
} from "../shared/wire.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import type { ProjectTrustError } from "./ProjectTrust.ts";
import { Registry, type RegistryError } from "./Registry.ts";
import { SidebarView } from "./SidebarView.ts";
import { createWorktree, listWorktrees, WorktreeError } from "./Worktrees.ts";

export type ReadyWorktree = Extract<WorktreeResult, { status: "ready" }>;

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
    /** Register an existing checkout of a registered folder. */
    readonly addWorktree: (
      folder: string,
      path: string,
    ) => Effect.Effect<ReadyWorktree, WorktreeError | RegistryError>;
    /** Create a new branch checkout through Worktrunk and register it. */
    readonly createWorktree: (
      folder: string,
      branch: string,
      options: { readonly hooks?: boolean },
    ) => Effect.Effect<ReadyWorktree, WorktreeError | RegistryError>;
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
        // Pi's resources for this directory, and so its models and commands, change for sessions started from now.
        const decision = yield* facts.setTrust(path, trusted);
        // Trust lives in Pi's store, not the registry, so the sidebar hears of it here.
        yield* sidebar.changed;
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
      }),

      createWorktree: Effect.fn("WorkspaceCommands.createWorktree")(
        function* (folder, branch, options) {
          yield* registered(folder);
          const w = yield* createWorktree(folder, branch.trim(), { hooks: options.hooks });
          return yield* record({
            status: "ready",
            folder,
            path: w.path,
            branch: w.branch,
            creation: { baseBranch: w.baseBranch, hooks: w.hooks },
          });
        },
      ),
    });
  }),
);
