import { Effect, Layer } from "effect";
import { PromptsLive, UserSkillsLive } from "../../features/library/server/index.ts";
import { McpSetupLive } from "../../features/mcp/server/index.ts";
import { PiSettingsLive } from "../../features/models/server/index.ts";
import { type SidebarViewOptions } from "../../features/navigation/server/index.ts";
import { ProviderLoginLive } from "../../features/providers/server/index.ts";
import { RadiusSetupLive } from "../../features/radius/server/index.ts";
import {
  CreationAttemptsLive,
  PiSessionsLive,
  SessionHostsLive,
  SessionReferencesLive,
} from "../../features/sessions/server/index.ts";
import { VoiceInputLive } from "../../features/voice-input/server/index.ts";
import { Webhooks, WebhooksLive } from "../../features/webhooks/server/index.ts";
import {
  SessionChangesLive,
  WorkspaceChangesLive,
  GitHubPullRequestsLive,
  SessionPullRequestsLive,
  WorkspaceCommandsLive,
  FolderWorktreesLive,
} from "../../features/workspace/server/index.ts";
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
