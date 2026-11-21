import { Layer } from "effect";
import { SessionStatusLive } from "../features/dispatch/SessionStatus.ts";
import { PromptsLive } from "../features/library/Prompts.ts";
import { UserSkillsLive } from "../features/library/UserSkills.ts";
import { McpSetupLive } from "../features/mcp/McpSetup.ts";
import { PiSettingsLive } from "../features/models/PiSettings.ts";
import { SidebarViewLive, type SidebarViewOptions } from "../features/navigation/SidebarView.ts";
import { ProviderLoginLive } from "../features/providers/ProviderLogin.ts";
import { RadiusSetupLive } from "../features/radius/RadiusSetup.ts";
import { CreationAttemptsLive } from "../features/sessions/CreationAttempts.ts";
import { PiSessionsLive } from "../features/sessions/pi/PiSessions.ts";
import { SessionHostsLive } from "../features/sessions/SessionHosts.ts";
import { SessionReferencesLive } from "../features/sessions/SessionReferences.ts";
import { SessionSharingLive } from "../features/sharing/SessionSharing.ts";
import { VoiceInputLive } from "../features/voice-input/VoiceInput.ts";
import { WebhooksLive } from "../features/webhooks/Webhooks.ts";
import { SessionChangesLive } from "../features/workspace/changes/SessionChanges.ts";
import { WorkspaceChangesLive } from "../features/workspace/changes/WorkspaceChanges.ts";
import { DirectoryFactsLive } from "../features/workspace/DirectoryFactsLive.ts";
import { GitHubPullRequestsLive } from "../features/workspace/pull-requests/GitHubPullRequests.ts";
import { SessionPullRequestsLive } from "../features/workspace/pull-requests/SessionPullRequests.ts";
import { WorkspaceCommandsLive } from "../features/workspace/WorkspaceCommands.ts";
import { FolderWorktreesLive } from "../features/workspace/worktrees/FolderWorktrees.ts";
import { RegistryLive } from "../shared/registry/Registry.ts";

export interface PianoServicesOptions extends SidebarViewOptions {
  readonly idleMs: number;
}

export const SessionServicesLive = (options: { idleMs: number }) =>
  SessionHostsLive(options).pipe(
    Layer.provideMerge(SessionReferencesLive),
    Layer.provideMerge(WebhooksLive),
    Layer.provideMerge(FolderWorktreesLive),
  );

export const PianoCoreLive = (options: PianoServicesOptions) =>
  WorkspaceCommandsLive.pipe(
    Layer.provideMerge(SidebarViewLive({ discover: options.discover })),
    Layer.provideMerge(DirectoryFactsLive),
    Layer.provideMerge(SessionServicesLive({ idleMs: options.idleMs })),
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
