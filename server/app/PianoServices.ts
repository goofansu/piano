import { Effect, Layer } from "effect";
import { PromptsLive } from "../../features/library/server/Prompts.ts";
import { UserSkillsLive } from "../../features/library/server/UserSkills.ts";
import { McpSetupLive } from "../../features/mcp/server/McpSetup.ts";
import { PiSettingsLive } from "../../features/models/server/PiSettings.ts";
import { type SidebarViewOptions } from "../../features/navigation/server/SidebarView.ts";
import { ProviderLoginLive } from "../../features/providers/server/ProviderLogin.ts";
import { RadiusSetupLive } from "../../features/radius/server/RadiusSetup.ts";
import { CreationAttemptsLive } from "../../features/sessions/server/CreationAttempts.ts";
import { PiSessionsLive } from "../../features/sessions/server/pi/PiSessions.ts";
import { SessionHostsLive } from "../../features/sessions/server/SessionHosts.ts";
import { SessionReferencesLive } from "../../features/sessions/server/SessionReferences.ts";
import { VoiceInputLive } from "../../features/voice-input/server/VoiceInput.ts";
import { Webhooks, WebhooksLive } from "../../features/webhooks/server/Webhooks.ts";
import { SessionChangesLive } from "../../features/workspace/server/changes/SessionChanges.ts";
import { WorkspaceChangesLive } from "../../features/workspace/server/changes/WorkspaceChanges.ts";
import { GitHubPullRequestsLive } from "../../features/workspace/server/pull-requests/GitHubPullRequests.ts";
import { SessionPullRequestsLive } from "../../features/workspace/server/pull-requests/SessionPullRequests.ts";
import { WorkspaceCommandsLive } from "../../features/workspace/server/WorkspaceCommands.ts";
import { FolderWorktreesLive } from "../../features/workspace/server/worktrees/FolderWorktrees.ts";
import { RegistryLive } from "../shared/registry/Registry.ts";
import { SessionStatusLive } from "./FeatureServices.ts";
import { SidebarViewLive } from "./FeatureServices.ts";
import { SessionSharingLive } from "./FeatureServices.ts";
import { DirectoryFactsLive } from "./FeatureServices.ts";

export interface PianoServicesOptions extends SidebarViewOptions {
  readonly idleMs: number;
}

export const SessionServicesLive = (options: { idleMs: number }) =>
  SessionHostsLive(
    options,
    Effect.map(Webhooks, (hooks) => hooks.observe),
  ).pipe(
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
