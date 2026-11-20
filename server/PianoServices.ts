import { Layer } from "effect";
import { CreationAttemptsLive } from "./CreationAttempts.ts";
import { DirectoryFactsLive } from "./DirectoryFacts.ts";
import { GitHubPullRequestsLive } from "./GitHubPullRequests.ts";
import { McpSetupLive } from "./McpSetup.ts";
import { PiSessionsLive } from "./PiSessions.ts";
import { PiSettingsLive } from "./PiSettings.ts";
import { PromptsLive } from "./Prompts.ts";
import { ProviderLoginLive } from "./ProviderLogin.ts";
import { RadiusSetupLive } from "./RadiusSetup.ts";
import { RegistryLive } from "./Registry.ts";
import { SessionChangesLive } from "./SessionChanges.ts";
import { SessionHostsLive } from "./SessionHosts.ts";
import { SessionPullRequestsLive } from "./SessionPullRequests.ts";
import { SessionSharingLive } from "./SessionSharing.ts";
import { SessionStatusLive } from "./SessionStatus.ts";
import { SidebarViewLive, type SidebarViewOptions } from "./SidebarView.ts";
import { UserSkillsLive } from "./UserSkills.ts";
import { VoiceInputLive } from "./VoiceInput.ts";
import { WorkspaceChangesLive } from "./WorkspaceChanges.ts";
import { WorkspaceCommandsLive } from "./WorkspaceCommands.ts";

export interface PianoServicesOptions extends SidebarViewOptions {
  readonly idleMs: number;
}

export const PianoCoreLive = (options: PianoServicesOptions) =>
  WorkspaceCommandsLive.pipe(
    Layer.provideMerge(SidebarViewLive({ discover: options.discover })),
    Layer.provideMerge(DirectoryFactsLive),
    Layer.provideMerge(SessionHostsLive({ idleMs: options.idleMs })),
    Layer.provideMerge(CreationAttemptsLive),
    Layer.provideMerge(RegistryLive),
    Layer.provideMerge(PiSessionsLive),
  );

export const PianoAdaptersLive = GitHubPullRequestsLive;

export const PianoServicesLive = (options: PianoServicesOptions) =>
  Layer.mergeAll(
    PiSettingsLive,
    RadiusSetupLive,
    McpSetupLive,
    UserSkillsLive,
    PromptsLive,
    VoiceInputLive,
    SessionStatusLive,
    SessionChangesLive,
    SessionPullRequestsLive,
    SessionSharingLive,
    ProviderLoginLive,
  ).pipe(Layer.provideMerge(WorkspaceChangesLive), Layer.provideMerge(PianoCoreLive(options)));
