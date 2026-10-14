/**
 * The per-session commands the sidebar row menu, the session header and the command palette offer,
 * described once: label, icon, group, whether it is available now, and what running it means.
 * Surfaces render these descriptors and hand them to the one `CommandHost` (see `commands.ts`).
 */
import type { ClientCommand } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import { type RadioChoice, radioChoiceOf } from "./commands.ts";
import {
  isSelectedSession,
  sessionCheckoutMissing,
  sessionContext,
  sessionMutable,
  sessionReference,
  sessionWorking,
  workspaceFor,
} from "./sessionContext.ts";

export type SessionDisplay = "everything" | "messages";
export const SESSION_DISPLAYS = [
  { value: "everything", label: "Show everything" },
  { value: "messages", label: "Messages only" },
] as const satisfies readonly { value: SessionDisplay; label: string }[];

export type SessionTarget = { cwd: string; sessionId: string; title?: string };

export type SessionCommandId =
  | "open-file"
  | "copy-working-directory"
  | "copy-branch"
  | "copy-session-id"
  | "copy-all"
  | "changes"
  | "pull-request"
  | "display-everything"
  | "display-messages"
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
  | "open-file"
  | "copy"
  | "changes"
  | "pull-request"
  | "everything"
  | "messages"
  | "rename"
  | "pin"
  | "unpin"
  | "share"
  | "archive"
  | "delete"
  | "new";

export type SessionCommandIntent =
  | { kind: "open-file" }
  | { kind: "send"; command: ClientCommand }
  | { kind: "copy"; value: string; label: string }
  | { kind: "changes" }
  | { kind: "pull-request" }
  | { kind: "display"; display: SessionDisplay }
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
  /** A display choice that is current. */
  checked?: boolean;
  /** Extra palette search words. */
  keywords?: readonly string[];
  /** Secondary text the palette shows after the label. */
  detail?: string;
  intent: SessionCommandIntent;
}

/** A session menu as a surface renders it: separated sections in order, then any display choice. */
export interface SessionMenu {
  /** The header's icon actions beside the session's details. */
  details?: SessionCommand[];
  /** Each section is one menu group; an empty one is left out. */
  sections: SessionCommand[][];
  /** The header's display radio. */
  display?: RadioChoice<SessionCommand>;
}

/** Each surface's sections, by command. The row puts archive beside delete, though only delete is destructive. */
const MENU_SECTIONS = {
  row: [["rename", "pin"], ["share"], ["archive", "delete"]],
  header: [["open-file", "changes", "pull-request"]],
} as const satisfies Record<string, readonly (readonly SessionCommandId[])[]>;

const pick = (commands: readonly SessionCommand[], ids: readonly SessionCommandId[]) =>
  commands.filter((c) => ids.includes(c.id));

/** The sidebar row's or the session header's menu, from `sessionCommands`' descriptors. */
export function sessionMenu(
  commands: readonly SessionCommand[],
  surface: "row" | "header",
): SessionMenu {
  const sections = MENU_SECTIONS[surface]
    .map((ids) => pick(commands, ids))
    .filter((section) => section.length > 0);
  if (surface === "row") return { sections };
  return {
    details: pick(commands, ["copy-all"]),
    sections,
    display: radioChoiceOf(commands.filter((c) => c.group === "display")),
  };
}

/**
 * Rename's rule, for its descriptor and for the answer to its form: the session is mutable and its
 * checkout is present, since renaming starts Pi there.
 */
export function canRenameSession(state: AppState, target: SessionTarget): boolean {
  return sessionMutable(state, target) && !sessionCheckoutMissing(state, target);
}

/** A saved, registered session; capture refuses in-flight work on the server too. */
export function canShareSession(state: AppState, target: SessionTarget): boolean {
  const reference = sessionReference(state, target);
  return (
    sessionMutable(state, target) &&
    !!workspaceFor(state, target.cwd) &&
    !!reference &&
    !reference.archived &&
    reference.unavailable !== "history" &&
    !state.hosts.some(
      (host) => host.cwd === target.cwd && host.sessionId === target.sessionId && host.streaming,
    )
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
 * - changes: a Git workspace whose checkout is present (`canOpenChanges`).
 * - pull request, copy session ID: the selected session has a Pi session ID.
 * - new session here: the checkout is present.
 * - copy and display commands: always.
 */
export function sessionCommands(
  state: AppState,
  target?: SessionTarget,
  options: { display?: SessionDisplay; radiusSignedIn?: boolean } = {},
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
    const display = options.display ?? "everything";
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
        label: "Copy all",
        icon: "copy",
        group: "copy",
        enabled: true,
        intent: { kind: "copy", value: all, label: "Session details" },
      },
      {
        id: "open-file",
        label: "Open file",
        icon: "open-file",
        group: "open",
        enabled: !!ctx.workspace && !session.state.checkoutMissing,
        keywords: ["file", "read", "path"],
        intent: { kind: "open-file" },
      },
      {
        id: "changes",
        label: "Changes",
        icon: "changes",
        group: "open",
        enabled: ctx.canOpenChanges,
        keywords: ["diff", "review", "working tree"],
        intent: { kind: "changes" },
      },
      {
        id: "pull-request",
        label: "Pull request",
        icon: "pull-request",
        group: "open",
        enabled: !!session.sessionId,
        keywords: ["github", "link", "pr"],
        intent: { kind: "pull-request" },
      },
      ...SESSION_DISPLAYS.map((d) => ({
        id: `display-${d.value}` as const,
        label: d.label,
        icon: d.value,
        group: "display" as const,
        enabled: true,
        checked: display === d.value,
        keywords: ["display", "view", "messages", "transcript"],
        intent: { kind: "display" as const, display: d.value },
      })),
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
              keywords: ["radius", "link", "publish"],
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
      keywords: ["new", "here", "directory"],
      detail: session.cwd,
      intent: { kind: "new-session", cwd: session.cwd },
    });
  }
  return commands;
}
