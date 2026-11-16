import type { ClientCommand } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import { LOCAL } from "./machine.ts";
import { machineOffers } from "./machineOffers.ts";
import type { SessionLayout } from "./navigation.ts";
import { type PreviewObservationState, seenPreview } from "./previewObservation.ts";
import { pullRequestView } from "./pullRequestView.ts";
import { sessionArtifacts } from "./sessionArtifacts.ts";
import {
  isSelectedSession,
  sessionCheckoutMissing,
  sessionContext,
  sessionMutable,
  sessionReady,
  sessionReference,
  sessionWorking,
} from "./sessionContext.ts";
import {
  type PreviewClaim,
  previewClaim,
  previewHost,
  sessionHasPreview,
} from "./sessionPreview.ts";

export type SessionTarget = { cwd: string; sessionId: string; title?: string };

const AGENT_ONLY: SessionLayout = {
  single: false,
  agent: true,
  surface: false,
  rail: false,
  agentTab: false,
};

export type SessionCommandId =
  | "copy-working-directory"
  | "copy-branch"
  | "copy-commit"
  | "copy-repository"
  | "copy-pull-request-reference"
  | "copy-session-id"
  | "copy-session-path"
  | "changes"
  | "artifacts"
  | "session-rail"
  | "agent"
  | "wrap-code"
  | "pull-request"
  | "open-preview"
  | "preview-details"
  | "stop-preview"
  | "messages-only"
  | "rename"
  | "pin"
  | "archive"
  | "delete"
  | "new-session-here";

export type SessionCommandIcon =
  | "copy"
  | "changes"
  | "wrap"
  | "artifacts"
  | "list"
  | "agent"
  | "pull-request"
  | "preview"
  | "details"
  | "stop"
  | "messages"
  | "rename"
  | "pin"
  | "unpin"
  | "archive"
  | "delete"
  | "new";

export type SessionCommandIntent =
  | { kind: "send"; command: ClientCommand }
  | { kind: "copy"; value: string; label: string }
  | { kind: "changes" }
  | { kind: "artifacts" }
  | { kind: "session-rail" }
  | { kind: "agent" }
  | { kind: "wrap-code"; on: boolean }
  | { kind: "pull-request"; linked: boolean }
  | { kind: "open-url"; url: string }
  | ({ kind: "stop-preview"; host: string } & PreviewClaim)
  | { kind: "preview-details" }
  | { kind: "messages-only"; on: boolean }
  | { kind: "rename" | "delete"; target: SessionTarget | undefined }
  | { kind: "archive"; target: SessionTarget | undefined; confirm: boolean }
  | { kind: "new-session"; cwd: string };

export interface SessionCommand {
  id: SessionCommandId;
  label: string;
  icon: SessionCommandIcon;
  enabled: boolean;
  destructive?: true;
  hidden?: boolean;
  checked?: boolean;
  keywords?: readonly string[];
  detail?: string;
  intent: SessionCommandIntent;
}

export type SessionMenuSection = SessionCommand[] | "project";

export interface SessionRowMenu {
  sections: SessionMenuSection[];
}

export interface SessionHeaderMenu {
  details: SessionCommand[];
  sections: (SessionMenuSection | "display")[];
  display?: SessionCommand;
}

export type EnvironmentRowKind = "repository" | "folder" | "commit" | "branch" | "pull request";
const ENVIRONMENT_ROWS = {
  repository: ["copy-repository", "copy-working-directory"],
  folder: ["copy-working-directory"],
  commit: ["copy-commit"],
  branch: ["copy-branch"],
  "pull request": ["copy-pull-request-reference"],
} as const satisfies Record<EnvironmentRowKind, readonly SessionCommandId[]>;

export function environmentRowMenu(
  commands: readonly SessionCommand[],
  row: EnvironmentRowKind,
): SessionCommand[] {
  return ENVIRONMENT_ROWS[row].flatMap((id) => commands.filter((c) => c.id === id));
}

const END_OF_LIFE = ["archive", "delete"] as const;
const ROW_SECTIONS = [["rename", "pin"], "project", END_OF_LIFE] as const;
const HEADER_SECTIONS = [["rename", "pin"], "project", "display", END_OF_LIFE] as const;
const HEADER_DETAILS = ["copy-session-path"] as const;

const pick = (commands: readonly SessionCommand[], ids: readonly SessionCommandId[]) =>
  ids.flatMap((id) => commands.filter((c) => c.id === id));

function lay<Slot extends string>(
  commands: readonly SessionCommand[],
  layout: readonly (readonly SessionCommandId[] | Slot)[],
  has: (slot: Slot) => boolean,
): (SessionCommand[] | Slot)[] {
  return layout.flatMap<SessionCommand[] | Slot>((s) => {
    if (typeof s === "string") return has(s) ? [s] : [];
    const section = pick(commands, s);
    return section.length > 0 ? [section] : [];
  });
}

export function sessionRowMenu(commands: readonly SessionCommand[]): SessionRowMenu {
  return { sections: lay<"project">(commands, ROW_SECTIONS, () => true) };
}

export function sessionHeaderMenu(commands: readonly SessionCommand[]): SessionHeaderMenu {
  const display = commands.find((c) => c.id === "messages-only");
  return {
    details: pick(commands, HEADER_DETAILS),
    sections: lay<"project" | "display">(
      commands,
      HEADER_SECTIONS,
      (slot) => slot === "project" || !!display,
    ),
    display,
  };
}

export function canRenameSession(state: AppState, target: SessionTarget): boolean {
  return sessionMutable(state, target) && !sessionCheckoutMissing(state, target);
}

export function sessionCommands(
  state: AppState,
  target?: SessionTarget,
  options: {
    messagesOnly?: boolean;
    codeWrap?: boolean;
    layout?: SessionLayout;
    previewObservation?: Pick<PreviewObservationState, "unconfirmed">;
    startsSessionIn?: (state: AppState, cwd: string) => boolean;
  } = {},
): SessionCommand[] {
  const session = state.session;
  const ctx = sessionContext(state);
  const selected = !!session && (!target || isSelectedSession(state, target));
  const ref = session?.sessionId ? { cwd: session.cwd, sessionId: session.sessionId } : undefined;
  const subject = target ?? (ref && { ...ref, title: sessionReference(state, ref)?.title });
  const commands: SessionCommand[] = [];
  if (selected && session) {
    const messagesOnly = options.messagesOnly ?? false;
    const { agentTab, rail, single } = options.layout ?? AGENT_ONLY;
    const sessionPath = session.state.sessionFile;
    const linked = !!ctx.pullRequest;
    const pullRequest = pullRequestView({ link: ctx.pullRequest ?? null, pullRequest: null });
    const hasArtifacts = sessionArtifacts(session.messages, session.state.artifacts).length > 0;
    commands.push(
      {
        id: "copy-working-directory",
        label: "Copy directory path",
        icon: "copy",
        enabled: true,
        keywords: ["cwd", "working directory", "folder"],
        intent: { kind: "copy", value: session.cwd, label: "Directory path" },
      },
      ...(ctx.branch
        ? [
            {
              id: "copy-branch",
              label: "Copy branch",
              icon: "copy",
              enabled: true,
              keywords: ["git"],
              intent: { kind: "copy", value: ctx.branch, label: "Branch" },
            } as const,
          ]
        : []),
      ...(ctx.detachedHead
        ? [
            {
              id: "copy-commit",
              label: "Copy commit SHA",
              icon: "copy",
              enabled: true,
              keywords: ["detached", "head"],
              intent: { kind: "copy", value: ctx.detachedHead, label: "Commit SHA" },
            } as const,
          ]
        : []),
      ...(ctx.githubRepo
        ? [
            {
              id: "copy-repository",
              label: "Copy repository name",
              icon: "copy",
              enabled: true,
              keywords: ["github"],
              intent: { kind: "copy", value: ctx.githubRepo, label: "Repository name" },
            } as const,
          ]
        : []),
      ...(pullRequest?.reference
        ? [
            {
              id: "copy-pull-request-reference",
              label: "Copy pull request reference",
              icon: "copy",
              enabled: true,
              intent: {
                kind: "copy",
                value: pullRequest.reference,
                label: "Pull request reference",
              },
            } as const,
          ]
        : []),
      {
        id: "copy-session-id",
        label: "Copy session ID",
        icon: "copy",
        enabled: !!ctx.sessionId,
        intent: { kind: "copy", value: ctx.sessionId ?? "", label: "Session ID" },
      },
      {
        id: "copy-session-path",
        label: "Copy session path",
        icon: "copy",
        enabled: !!sessionPath,
        intent: { kind: "copy", value: sessionPath ?? "", label: "Session path" },
      },
      {
        id: "changes",
        label: "Changes",
        icon: "changes",
        enabled: ctx.canOpenChanges,
        keywords: ["diff"],
        detail: ctx.changesUnavailable,
        intent: { kind: "changes" },
      },
      {
        id: "artifacts",
        label: "Artifacts",
        icon: "artifacts",
        enabled: hasArtifacts,
        hidden: !hasArtifacts,
        intent: { kind: "artifacts" },
      },
      {
        id: "session-rail",
        label: rail ? "Hide session rail" : "Show session rail",
        icon: "list",
        enabled: !single,
        hidden: single,
        keywords: ["details", "info", "outputs", "files", "branch"],
        intent: { kind: "session-rail" },
      },
      {
        id: "agent",
        label: "Agent",
        icon: "agent",
        enabled: agentTab,
        hidden: !agentTab,
        keywords: ["conversation"],
        intent: { kind: "agent" },
      },
      {
        id: "wrap-code",
        label: "Wrap",
        icon: "wrap",
        enabled: true,
        checked: options.codeWrap ?? false,
        keywords: ["wrap lines"],
        intent: { kind: "wrap-code", on: !options.codeWrap },
      },
      {
        id: "pull-request",
        label: "Pull request",
        icon: "pull-request",
        enabled: !!ctx.pullRequestTarget,
        detail: ctx.changesUnavailable,
        keywords: ["pr"],
        intent: { kind: "pull-request", linked },
      },
      ...(options.previewObservation ? previewCommands(state, options.previewObservation) : []),
      {
        id: "messages-only",
        label: "Messages only",
        icon: "messages",
        enabled: true,
        checked: messagesOnly,
        intent: { kind: "messages-only", on: !messagesOnly },
      },
    );
  }
  if (selected || subject) {
    const mutable = !!subject && sessionMutable(state, subject);
    const reference = subject && sessionReference(state, subject);
    commands.push(
      {
        id: "rename",
        label: "Rename",
        icon: "rename",
        keywords: ["title"],
        enabled: !!subject && canRenameSession(state, subject),
        intent: { kind: "rename", target: subject },
      },
      ...(subject
        ? [
            {
              id: "pin" as const,
              label: reference?.pinned ? "Unpin" : "Pin",
              icon: reference?.pinned ? ("unpin" as const) : ("pin" as const),
              enabled: state.connected && !!reference && !reference.archived,
              intent: {
                kind: "send" as const,
                command: {
                  _tag: "pin_session" as const,
                  cwd: subject.cwd,
                  sessionId: subject.sessionId,
                  pinned: !reference?.pinned,
                },
              },
            },
          ]
        : []),
      {
        id: "archive",
        label: "Archive",
        icon: "archive",
        enabled: mutable,
        intent: {
          kind: "archive",
          target: subject,
          confirm:
            !!subject && (sessionWorking(state, subject) || sessionHasPreview(state, subject)),
        },
      },
      {
        id: "delete",
        label: "Delete",
        icon: "delete",
        destructive: true,
        enabled: mutable,
        intent: { kind: "delete", target: subject },
      },
    );
  }
  if (selected && session) {
    commands.push({
      id: "new-session-here",
      label: "New session here",
      icon: "new",
      enabled: (options.startsSessionIn ?? machineOffers(LOCAL).startsSessionIn)(
        state,
        session.cwd,
      ),
      keywords: ["directory"],
      detail: session.cwd,
      intent: { kind: "new-session", cwd: session.cwd },
    });
  }
  return commands;
}

function previewCommands(
  state: AppState,
  observed: Pick<PreviewObservationState, "unconfirmed">,
): SessionCommand[] {
  const preview = seenPreview(state, observed);
  const claim = previewClaim(state);
  if (!preview || !claim) return [];
  return [
    {
      id: "open-preview",
      label: "Open preview in new tab",
      icon: "preview",
      enabled: !!preview.url,
      keywords: ["app", "run", "localhost"],
      ...(preview.url && { detail: previewHost(preview.url) }),
      intent: { kind: "open-url", url: preview.url ?? "" },
    },
    {
      id: "preview-details",
      label: "Preview details",
      icon: "details",
      enabled: true,
      keywords: ["logs", "app"],
      intent: { kind: "preview-details" },
    },
    {
      id: "stop-preview",
      label: "Stop preview",
      icon: "stop",
      destructive: true,
      enabled: sessionReady(state),
      keywords: ["app", "kill"],
      intent: {
        kind: "stop-preview",
        ...claim,
        host: preview.url ? previewHost(preview.url) : "this app",
      },
    },
  ];
}
