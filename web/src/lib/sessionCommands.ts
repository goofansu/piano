/**
 * The per-session commands the sidebar row menu, the session header and the command palette offer,
 * described once: label, icon, whether it is available now, and what running it means.
 * Surfaces render these descriptors and hand them to the one `CommandHost` (see `commands.ts`).
 */
import type { ClientCommand } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import { type NavigationState, shownAreas } from "./navigation.ts";
import {
  checkoutMissingAt,
  isSelectedSession,
  sessionCheckoutMissing,
  sessionContext,
  sessionMutable,
  sessionReady,
  sessionReference,
  sessionWorking,
  workspaceFor,
} from "./sessionContext.ts";
import { previewHost, selectedPreview, sessionHasPreview, stopPreview } from "./sessionPreview.ts";

export type SessionTarget = { cwd: string; sessionId: string; title?: string };

/** The selected session's areas as navigation has them, which the view commands follow. */
export type SessionAreas = Pick<
  NavigationState,
  "surface" | "single" | "area" | "details" | "covered"
>;

/** Side by side with only the Agent area and Details off. */
const NO_AREAS: SessionAreas = {
  surface: null,
  single: false,
  area: "agent",
  details: false,
  covered: false,
};

export type SessionCommandId =
  | "copy-working-directory"
  | "copy-branch"
  | "copy-session-id"
  | "copy-session-path"
  | "changes"
  | "details"
  | "agent"
  | "wrap-changes"
  | "pull-request"
  | "open-preview"
  | "preview-details"
  | "stop-preview"
  | "messages-only"
  | "rename"
  | "pin"
  | "share"
  | "archive"
  | "delete"
  | "new-session-here";

export type SessionCommandIcon =
  | "copy"
  | "changes"
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
  | "share"
  | "archive"
  | "delete"
  | "new";

export type SessionCommandIntent =
  | { kind: "send"; command: ClientCommand }
  | { kind: "copy"; value: string; label: string }
  | { kind: "changes" }
  /**
   * Turn the session rail (the session's folder, branch and directory, its outputs and its
   * links) on or off beside the Agent area.
   */
  | { kind: "details" }
  /** Show the Agent area in a single-view layout. */
  | { kind: "agent" }
  | { kind: "wrap-changes"; on: boolean }
  | { kind: "pull-request" }
  /** Open the app in a new tab. */
  | { kind: "open-url"; url: string }
  | { kind: "preview-details" }
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
  enabled: boolean;
  /** Shown in the destructive style: Delete. */
  destructive?: true;
  /**
   * Not offered on this screen at all, so the palette leaves it out instead of greying it: a
   * command only one layout has (the session rail side by side, Agent one area at a
   * time). Always with `enabled` false; a command disabled for a reason the user can act on stays.
   */
  hidden?: boolean;
  /** A display toggle that is currently on. */
  checked?: boolean;
  /** Direct synonyms of the label, for palette search; not topics or what the command touches. */
  keywords?: readonly string[];
  /** Secondary text the palette shows after the label. */
  detail?: string;
  intent: SessionCommandIntent;
}

/**
 * The sidebar row's menu: separated sections in order, an empty one left out; the project picker
 * follows them, and the destructive commands come last.
 */
export interface SessionRowMenu {
  sections: SessionCommand[][];
  destructive: SessionCommand[];
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

const ROW_SECTIONS = [["rename", "pin"], ["share"]] as const;
/** Archive sits beside delete, though only delete is destructive: both end the session's life. */
const DESTRUCTIVE = ["archive", "delete"] as const;
const HEADER_SECTIONS = {
  details: ["copy-session-path"],
  // The header's preview control carries open and stop, and its Changes button (or, one area at a
  // time, the area tabs) Changes; the menu lists none of them twice.
  open: ["pull-request"],
  manage: ["rename", "pin", "share"],
  destructive: DESTRUCTIVE,
} as const satisfies Record<string, readonly SessionCommandId[]>;

const pick = (commands: readonly SessionCommand[], ids: readonly SessionCommandId[]) =>
  commands.filter((c) => ids.includes(c.id));

/** The sidebar row's menu, from `sessionCommands`' descriptors. */
export function sessionRowMenu(commands: readonly SessionCommand[]): SessionRowMenu {
  return {
    sections: ROW_SECTIONS.map((ids) => pick(commands, ids)).filter((s) => s.length > 0),
    destructive: pick(commands, DESTRUCTIVE),
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
 * - changes: a Git workspace whose checkout is present (`canOpenChanges`); otherwise it says why.
 * - details: the session is laid out side by side, the only layout with room for the session
 *   rail (its facts need neither Git nor a live Pi); "Hide session rail" while it shows, else
 *   "Show session rail".
 * - agent: the session is laid out one area at a time and the Agent tab shows, beside an open
 *   Surface tab.
 * - pull request, copy session ID: the selected session has a Pi session ID.
 * - open, stop and details of the preview: listed only while the selected session's live Pi owns
 *   an app; open needs its link, stop needs the attachment (`sessionReady`).
 * - new session here: the checkout is present.
 * - copy session path: saved history has supplied its file path; no live Pi needed.
 * - other copy commands and Messages only: always (session ID requires an ID).
 */
export function sessionCommands(
  state: AppState,
  target?: SessionTarget,
  options: {
    messagesOnly?: boolean;
    changesWrap?: boolean;
    radiusSignedIn?: boolean;
    /** The session's areas as navigation has them; by default side by side with only Agent. */
    areas?: SessionAreas;
  } = {},
): SessionCommand[] {
  const session = state.session;
  const ctx = sessionContext(state);
  const selected = !!session && (!target || isSelectedSession(state, target));
  // The registry title, as a sidebar row hands over; "Untitled" is display copy, not a title.
  const ref = session?.sessionId ? { cwd: session.cwd, sessionId: session.sessionId } : undefined;
  const subject = target ?? (ref && { ...ref, title: sessionReference(state, ref)?.title });
  const commands: SessionCommand[] = [];
  if (selected && session) {
    const messagesOnly = options.messagesOnly ?? false;
    const areas = options.areas ?? NO_AREAS;
    const { surface, single } = areas;
    // One area at a time, Agent has a tab while something is open beside it.
    const agentTab = single && !!surface;
    const sessionPath = session.state.sessionFile;
    commands.push(
      {
        id: "copy-working-directory",
        label: "Copy working directory",
        icon: "copy",
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
              enabled: true,
              intent: { kind: "copy", value: ctx.branch, label: "Git branch" },
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
        id: "details",
        label: shownAreas(areas).details ? "Hide session rail" : "Show session rail",
        icon: "list",
        enabled: !single,
        hidden: single,
        keywords: ["details", "info", "outputs", "files", "links", "branch"],
        intent: { kind: "details" },
      },
      {
        id: "agent",
        label: "Agent",
        icon: "agent",
        enabled: agentTab,
        // Agent exists only as a tab, so without one there is nothing to grey.
        hidden: !agentTab,
        keywords: ["conversation"],
        intent: { kind: "agent" },
      },
      {
        id: "wrap-changes",
        label: "Wrap",
        detail: "Changes",
        icon: "changes",
        enabled: ctx.canOpenChanges,
        checked: options.changesWrap ?? false,
        keywords: ["wrap lines"],
        intent: { kind: "wrap-changes", on: !options.changesWrap },
      },
      {
        id: "pull-request",
        label: "Pull request",
        icon: "pull-request",
        enabled: !!session.sessionId,
        keywords: ["pr"],
        intent: { kind: "pull-request" },
      },
      ...previewCommands(state),
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
      ...(options.radiusSignedIn
        ? [
            {
              id: "share" as const,
              label: "Share",
              icon: "share" as const,
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
      enabled: !checkoutMissingAt(state, session.cwd),
      keywords: ["directory"],
      detail: session.cwd,
      intent: { kind: "new-session", cwd: session.cwd },
    });
  }
  return commands;
}

/** The selected session's app commands; none unless its live Pi owns one. */
function previewCommands(state: AppState): SessionCommand[] {
  const preview = selectedPreview(state);
  if (!preview) return [];
  return [
    {
      id: "open-preview",
      label: "Open preview",
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
      enabled: sessionReady(state),
      keywords: ["app", "kill"],
      intent: { kind: "send", command: stopPreview(preview) },
    },
  ];
}
