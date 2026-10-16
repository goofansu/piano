/**
 * The per-session commands the sidebar row menu, the session header and the command palette offer,
 * described once: label, icon, group, whether it is available now, and what running it means.
 * Surfaces render these descriptors and hand them to the one `CommandHost` (see `commands.ts`).
 */
import type { ClientCommand } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import {
  isSelectedSession,
  sessionCheckoutMissing,
  sessionContext,
  sessionMutable,
  sessionReference,
  sessionWorking,
  workspaceFor,
} from "./sessionContext.ts";

export type SessionTarget = { cwd: string; sessionId: string; title?: string };

export type SessionCommandId =
  | "copy-working-directory"
  | "copy-branch"
  | "copy-session-id"
  | "copy-all"
  | "changes"
  | "pull-request"
  | "messages-only"
  | "rename"
  | "pin"
  | "share"
  | "archive"
  | "delete"
  | "new-session-here";

/** Sections a menu separates; the palette lists them in this order under Session commands. */
export type SessionCommandGroup =
  | "copy"
  | "open"
  | "display"
  | "manage"
  | "share"
  | "destructive"
  | "create";

export type SessionCommandIcon =
  | "copy"
  | "changes"
  | "pull-request"
  | "messages"
  | "rename"
  | "pin"
  | "unpin"
  | "share"
  | "archive"
  | "delete"
  | "new";

export type SessionCommandIntent =
  | { kind: "send"; command: ClientCommand }
  | { kind: "copy"; value: string; label: string }
  | { kind: "changes" }
  | { kind: "pull-request" }
  /** Turn Messages only on or off. */
  | { kind: "messages-only"; on: boolean }
  /** Without a target the selected session has no Pi session ID yet; such a command is never enabled. */
  | { kind: "rename" | "share" | "delete"; target: SessionTarget | undefined }
  | { kind: "archive"; target: SessionTarget | undefined; confirm: boolean }
  | { kind: "new-session"; cwd: string };

export interface SessionCommand {
  id: SessionCommandId;
  label: string;
  icon: SessionCommandIcon;
  group: SessionCommandGroup;
  enabled: boolean;
  /** A toggle that is on: Messages only. Its label already names what running it does. */
  checked?: boolean;
  /** Direct synonyms of the label, for palette search; not topics or what the command touches. */
  keywords?: readonly string[];
  /** Secondary text the palette shows after the label. */
  detail?: string;
  intent: SessionCommandIntent;
}

/** The sidebar row's menu: separated sections in order, an empty one left out. */
export interface SessionRowMenu {
  sections: SessionCommand[][];
}

/**
 * The session header's menu, which the desktop dropdown and the phone sheet lay out alike: the
 * details with their copy action, then open, manage (the project picker follows it), the display
 * switch, and the destructive commands last.
 */
export interface SessionHeaderMenu {
  /** Icon actions beside the session's details. */
  details: SessionCommand[];
  open: SessionCommand[];
  manage: SessionCommand[];
  /** The Messages only switch: `checked` while on; running it toggles. */
  display?: SessionCommand;
  destructive: SessionCommand[];
}

/** The row puts archive beside delete, though only delete is destructive. */
const ROW_SECTIONS = [["rename", "pin"], ["share"], ["archive", "delete"]] as const;
const HEADER_SECTIONS = {
  details: ["copy-all"],
  open: ["changes", "pull-request"],
  manage: ["rename", "pin", "share"],
  destructive: ["archive", "delete"],
} as const satisfies Record<string, readonly SessionCommandId[]>;

const pick = (commands: readonly SessionCommand[], ids: readonly SessionCommandId[]) =>
  commands.filter((c) => ids.includes(c.id));

/** The sidebar row's menu, from `sessionCommands`' descriptors. */
export function sessionRowMenu(commands: readonly SessionCommand[]): SessionRowMenu {
  return {
    sections: ROW_SECTIONS.map((ids) => pick(commands, ids)).filter((s) => s.length > 0),
  };
}

/** The session header's menu, from `sessionCommands`' descriptors. */
export function sessionHeaderMenu(commands: readonly SessionCommand[]): SessionHeaderMenu {
  return {
    details: pick(commands, HEADER_SECTIONS.details),
    open: pick(commands, HEADER_SECTIONS.open),
    manage: pick(commands, HEADER_SECTIONS.manage),
    display: commands.find((c) => c.id === "messages-only"),
    destructive: pick(commands, HEADER_SECTIONS.destructive),
  };
}

/**
 * Rename's rule, for its descriptor and for the answer to its form: the session is mutable and its
 * checkout is present, since renaming starts Pi there.
 */
export function canRenameSession(state: AppState, target: SessionTarget): boolean {
  return sessionMutable(state, target) && !sessionCheckoutMissing(state, target);
}

/**
 * A saved, registered session that is not working (`sessionWorking`, the rule Archive and Delete
 * confirm on); capture refuses in-flight work on the server too.
 */
export function canShareSession(state: AppState, target: SessionTarget): boolean {
  const reference = sessionReference(state, target);
  return (
    sessionMutable(state, target) &&
    !!workspaceFor(state, target.cwd) &&
    !!reference &&
    !reference.archived &&
    reference.unavailable !== "history" &&
    !sessionWorking(state, target)
  );
}

/**
 * Commands for `target`, or for the selected session when it is omitted. The selected session gets
 * every command; any other session only the management actions (rename, pin, archive, delete).
 *
 * Enablement, one rule per command:
 * - rename, archive, delete: `sessionMutable` (connected, and a settled attachment for the selected
 *   session); rename also needs the checkout, since renaming starts Pi there.
 * - pin: connected with an active registry reference; independent of Pi attachment or activity.
 * - share (Radius sign-in only): `canShareSession`, mutable, saved and registered, and not
 *   `sessionWorking`, the one busy rule Archive and Delete confirm on.
 * - changes: a Git workspace whose checkout is present (`canOpenChanges`).
 * - pull request, copy session ID: the selected session has a Pi session ID.
 * - new session here: the checkout is present.
 * - copy and Messages only: always.
 */
export function sessionCommands(
  state: AppState,
  target?: SessionTarget,
  options: { messagesOnly?: boolean; radiusSignedIn?: boolean } = {},
): SessionCommand[] {
  const session = state.session;
  const ctx = sessionContext(state);
  const selected = !!session && (!target || isSelectedSession(state, target));
  const subject =
    target ??
    (session?.sessionId
      ? { cwd: session.cwd, sessionId: session.sessionId, title: ctx.title }
      : undefined);
  const commands: SessionCommand[] = [];
  if (selected && session) {
    const messagesOnly = options.messagesOnly ?? false;
    const all = [
      `Working directory: ${session.cwd}`,
      ...(ctx.sessionId ? [`Session ID: ${ctx.sessionId}`] : []),
    ].join("\n");
    commands.push(
      {
        id: "copy-working-directory",
        label: "Copy working directory",
        icon: "copy",
        group: "copy",
        enabled: true,
        keywords: ["path", "cwd"],
        intent: { kind: "copy", value: session.cwd, label: "Working directory" },
      },
      ...(ctx.branch
        ? [
            {
              id: "copy-branch",
              label: "Copy git branch",
              icon: "copy",
              group: "copy",
              enabled: true,
              intent: { kind: "copy", value: ctx.branch, label: "Git branch" },
            } as const,
          ]
        : []),
      {
        id: "copy-session-id",
        label: "Copy session ID",
        icon: "copy",
        group: "copy",
        enabled: !!ctx.sessionId,
        intent: { kind: "copy", value: ctx.sessionId ?? "", label: "Session ID" },
      },
      {
        id: "copy-all",
        label: "Copy session details",
        icon: "copy",
        group: "copy",
        enabled: true,
        intent: { kind: "copy", value: all, label: "Session details" },
      },
      {
        id: "changes",
        label: "Changes",
        icon: "changes",
        group: "open",
        enabled: ctx.canOpenChanges,
        keywords: ["diff"],
        intent: { kind: "changes" },
      },
      {
        id: "pull-request",
        label: "Pull request",
        icon: "pull-request",
        group: "open",
        enabled: !!session.sessionId,
        keywords: ["pr"],
        intent: { kind: "pull-request" },
      },
      {
        id: "messages-only",
        label: "Messages only",
        icon: "messages",
        group: "display",
        enabled: true,
        checked: messagesOnly,
        intent: { kind: "messages-only", on: !messagesOnly },
      },
    );
  }
  if (selected || subject) {
    const mutable = !!subject && sessionMutable(state, subject);
    const reference =
      subject &&
      state.sessionReferences.find(
        (s) => s.cwd === subject.cwd && s.sessionId === subject.sessionId,
      );
    commands.push(
      {
        id: "rename",
        label: "Rename",
        icon: "rename",
        group: "manage",
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
              group: "manage" as const,
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
      ...(options.radiusSignedIn
        ? [
            {
              id: "share" as const,
              label: "Share",
              icon: "share" as const,
              group: "share" as const,
              enabled: !!subject && canShareSession(state, subject),
              keywords: ["link", "publish"],
              intent: { kind: "share" as const, target: subject },
            },
          ]
        : []),
      {
        id: "archive",
        label: "Archive",
        icon: "archive",
        group: "manage",
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
        group: "destructive",
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
      group: "create",
      enabled: !session.state.checkoutMissing,
      keywords: ["directory"],
      detail: session.cwd,
      intent: { kind: "new-session", cwd: session.cwd },
    });
  }
  return commands;
}
