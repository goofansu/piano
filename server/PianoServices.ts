/**
 * Piano's production service graph, wired once for `main.ts` and the tests alike.
 *
 * Some services must exist once per server, and the wiring here is what guarantees it:
 * `SessionHostsLive` and `SidebarViewLive` are functions, so building one a second time
 * silently makes a second instance. One SessionHosts owns every Pi child (INV-02) and also
 * provides the SessionReferences every caller shares, so all of them see one alias memory, and
 * the FolderWorktrees that both it and WorkspaceCommands create worktrees through.
 * Sharing reads the Radius credential through the same ProviderLogin the routes use.
 *
 * Callers supply only what lies outside Piano: the platform (child processes, files), the
 * external adapters in `PianoAdaptersLive`, and the Context references with defaults (PiCli,
 * RegistryDatabasePath, ...). Tests replace those, never the wiring.
 */
import { Layer } from "effect";
import { DirectoryFactsLive } from "./DirectoryFacts.ts";
import { GitHubPullRequestsLive } from "./GitHubPullRequests.ts";
import { McpSetupLive } from "./McpSetup.ts";
import { PiSessionsLive } from "./PiSessions.ts";
import { PiSettingsLive } from "./PiSettings.ts";
import { ProviderLoginLive } from "./ProviderLogin.ts";
import { RadiusArtifactsLive } from "./RadiusArtifacts.ts";
import { RadiusSetupLive } from "./RadiusSetup.ts";
import { RegistryLive } from "./Registry.ts";
import { SessionChangesLive } from "./SessionChanges.ts";
import { SessionHostsLive } from "./SessionHosts.ts";
import { SessionPullRequestsLive } from "./SessionPullRequests.ts";
import { SessionSharingLive } from "./SessionSharing.ts";
import { SessionStatusLive } from "./SessionStatus.ts";
import { SidebarViewLive, type SidebarViewOptions } from "./SidebarView.ts";
import { WorkspaceChangesLive } from "./WorkspaceChanges.ts";
import { WorkspaceCommandsLive } from "./WorkspaceCommands.ts";

export interface PianoServicesOptions extends SidebarViewOptions {
  /** How long a quiescent session keeps its Pi child before retirement; 0 never retires one. */
  readonly idleMs: number;
}

/**
 * Workspaces and sessions: the registry, Pi, the session hosts over them, directory facts,
 * the sidebar view and the workspace commands. Every service in the graph is exposed.
 */
export const PianoCoreLive = (options: PianoServicesOptions) =>
  WorkspaceCommandsLive.pipe(
    Layer.provideMerge(SidebarViewLive({ discover: options.discover })),
    Layer.provideMerge(DirectoryFactsLive),
    Layer.provideMerge(SessionHostsLive({ idleMs: options.idleMs })),
    Layer.provideMerge(RegistryLive),
    Layer.provideMerge(PiSessionsLive),
  );

/** The network services Piano calls; a test replaces one by providing its own. */
export const PianoAdaptersLive = Layer.mergeAll(RadiusArtifactsLive, GitHubPullRequestsLive);

/** Everything the router answers from: the core plus settings, setup, changes, pull requests,
 * session status and sharing. */
export const PianoServicesLive = (options: PianoServicesOptions) =>
  Layer.mergeAll(
    PiSettingsLive,
    RadiusSetupLive,
    McpSetupLive,
    SessionStatusLive,
    SessionChangesLive,
    SessionPullRequestsLive,
    SessionSharingLive.pipe(Layer.provideMerge(ProviderLoginLive)),
  ).pipe(Layer.provideMerge(WorkspaceChangesLive), Layer.provideMerge(PianoCoreLive(options)));
