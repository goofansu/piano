import { pullRequestLabel } from "../../../shared/git/pullRequestIdentity.ts";
import type { ClientCommand, Snapshot } from "../../../shared/wire.ts";
import type { SessionLayout } from "../../../web/src/shared/navigation/navigation.ts";
import { sessionWorking } from "../../../web/src/shared/state/sessionActivity.ts";
import {
  checkoutMissingAt,
  isSelectedSession,
  sessionCheckoutMissing,
  sessionContext,
  sessionMutable,
  sessionReference,
  sessionReferenceChangeable,
} from "../../../web/src/shared/state/sessionContext.ts";
import type { AppState } from "../../../web/src/shared/state/state.ts";

export type SessionTarget = { cwd: string; sessionId: string; title?: string };

const AGENT_ONLY: SessionLayout = {
  single: false,
  agent: true,
  inspector: false,
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
  | "messages-only"
  | "rename"
  | "pin"
  | "archive"
  | "delete"
  | "new-session-here"
  | "share";

export type SessionCommandIcon =
  | "hash"
  | "copy"
  | "changes"
  | "wrap"
  | "artifacts"
  | "list"
  | "agent"
  | "pull-request"
  | "messages"
  | "rename"
  | "pin"
  | "unpin"
  | "archive"
  | "delete"
  | "new"
  | "share";

export type SessionCommandIntent =
  | { kind: "send"; command: ClientCommand }
  | { kind: "copy"; value: string; label: string }
  | { kind: "changes" }
  | { kind: "artifacts" }
  | { kind: "session-rail" }
  | { kind: "agent" }
  | { kind: "wrap-code"; on: boolean }
  | { kind: "pull-request"; linked: boolean }
  | { kind: "messages-only"; on: boolean }
  | { kind: "rename" | "delete" | "share"; target: SessionTarget | undefined }
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
const ROW_SECTIONS = [
  ["rename", "pin", "share", "copy-session-id"],
  "project",
  END_OF_LIFE,
] as const;
const HEADER_SECTIONS = [["rename", "pin", "share"], "project", "display", END_OF_LIFE] as const;

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
  target: SessionTarget | undefined,
  options: {
    hasArtifacts?: (session: Snapshot) => boolean;
    messagesOnly?: boolean;
    codeWrap?: boolean;
    layout?: SessionLayout;
  },
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
    const pullRequest = pullRequestLabel(ctx.pullRequest);
    const hasArtifacts = options.hasArtifacts?.(session) ?? false;
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
        enabled: !!ctx.pullRequestTarget && !!ref && sessionReferenceChangeable(state, ref),
        detail: ctx.changesUnavailable,
        keywords: ["pr"],
        intent: { kind: "pull-request", linked },
      },
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
        id: "copy-session-id",
        label: "Copy session id",
        icon: "hash",
        enabled: !!subject?.sessionId,
        intent: { kind: "copy", value: subject?.sessionId ?? "", label: "Session ID" },
      },
      {
        id: "share",
        label: "Share",
        icon: "share",
        enabled: !!subject && sessionReferenceChangeable(state, subject),
        intent: { kind: "share", target: subject },
      },
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
              enabled: sessionReferenceChangeable(state, subject),
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
          confirm: !!subject && sessionWorking(state, subject),
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
    const checkoutMissing = checkoutMissingAt(state, session.cwd);
    commands.push({
      id: "new-session-here",
      label: "New session here",
      icon: "new",
      enabled: !checkoutMissing,
      keywords: ["directory"],
      detail: checkoutMissing ? "Checkout removed" : session.cwd,
      intent: { kind: "new-session", cwd: session.cwd },
    });
  }
  return commands;
}
