/**
 * The per-session commands the sidebar row menu, the session header and the command palette offer,
 * described once: label, icon, whether it is available now, and what running it means.
 * Surfaces render these descriptors and hand them to the one `CommandHost` (see `commands.ts`).
 */
import type { ClientCommand } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";
import type { SessionLayout } from "./navigation.ts";
import { type PreviewObservationState, seenPreview } from "./previewObservation.ts";
import { pullRequestView } from "./pullRequestView.ts";
import { sessionArtifacts } from "./sessionArtifacts.ts";
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
import {
  type PreviewClaim,
  previewClaim,
  previewHost,
  sessionHasPreview,
} from "./sessionPreview.ts";

export type SessionTarget = { cwd: string; sessionId: string; title?: string };

/** Side by side with only the Agent area and the session rail off. */
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
  | "show-preview"
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
  | "share"
  | "archive"
  | "delete"
  | "new";

export type SessionCommandIntent =
  | { kind: "send"; command: ClientCommand }
  | { kind: "copy"; value: string; label: string }
  | { kind: "changes" }
  /** Open the session header's Artifacts menu. */
  | { kind: "artifacts" }
  /**
   * Turn the session rail (the session's folder, branch and directory, and its outputs) on or off
   * beside the Agent area.
   */
  | { kind: "session-rail" }
  /** Show the Agent area in a single-view layout. */
  | { kind: "agent" }
  /** Turn wrapping of long code lines, in Changes and a file's source alike, on or off. */
  | { kind: "wrap-code"; on: boolean }
  /** Read a linked pull request in Changes, or link one in its dialog. */
  | { kind: "pull-request"; linked: boolean }
  /** Open the app in a new tab. */
  | { kind: "open-url"; url: string }
  /** Stop the app it claims, only while that app is still the one on screen. */
  | ({ kind: "stop-preview"; host: string } & PreviewClaim)
  | { kind: "show-preview" }
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
   * command only one layout has (Agent one area at a time). Always with `enabled` false; a command disabled for a reason the user can act on stays.
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
 * A session menu's separated section: its commands, or `"project"`, the slot where the surface
 * places the session's project section (`sessionProjectMenu`).
 */
export type SessionMenuSection = SessionCommand[] | "project";

/** The sidebar row's menu: separated sections in order, an empty one left out. */
export interface SessionRowMenu {
  sections: SessionMenuSection[];
}

/**
 * The session header's menu, which the desktop dropdown and the phone sheet lay out alike: the
 * details with their copy action, then its separated sections in order.
 */
export interface SessionHeaderMenu {
  /** Icon actions beside the session's details. */
  details: SessionCommand[];
  /** In order; `"display"` stands for the Messages only switch, present only with `display`. */
  sections: (SessionMenuSection | "display")[];
  /** The Messages only switch: `checked` while on; running it toggles. */
  display?: SessionCommand;
}

/** The session rail's Environment rows, each with the copy commands its menu offers. */
export type EnvironmentRowKind = "repository" | "folder" | "commit" | "branch" | "pull request";
const ENVIRONMENT_ROWS = {
  repository: ["copy-repository", "copy-working-directory"],
  folder: ["copy-working-directory"],
  commit: ["copy-commit"],
  branch: ["copy-branch"],
  "pull request": ["copy-pull-request-reference"],
} as const satisfies Record<EnvironmentRowKind, readonly SessionCommandId[]>;

/** The session rail's Environment row menu, from `sessionCommands`' descriptors: the row's own
 * fact first. */
export function environmentRowMenu(
  commands: readonly SessionCommand[],
  row: EnvironmentRowKind,
): SessionCommand[] {
  return ENVIRONMENT_ROWS[row].flatMap((id) => commands.filter((c) => c.id === id));
}

/**
 * Every session menu's order (and the palette's, which places the row menu's): the manage
 * commands, then the project section, then the commands that end the session's life. Archive sits
 * beside Delete, though only Delete is destructive: both end the session's life.
 */
const END_OF_LIFE = ["archive", "delete"] as const;
const ROW_SECTIONS = [["rename", "pin"], ["share"], "project", END_OF_LIFE] as const;
// Preview and Changes have their own controls; PR linking lives in Changes.
const HEADER_SECTIONS = [["rename", "pin", "share"], "project", "display", END_OF_LIFE] as const;
const HEADER_DETAILS = ["copy-session-path"] as const;

/** The commands with these IDs, in the IDs' order rather than the descriptors'. */
const pick = (commands: readonly SessionCommand[], ids: readonly SessionCommandId[]) =>
  ids.flatMap((id) => commands.filter((c) => c.id === id));

/** A layout's sections from the descriptors, an empty one and an absent slot left out. */
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

/** The sidebar row's menu, from `sessionCommands`' descriptors. */
export function sessionRowMenu(commands: readonly SessionCommand[]): SessionRowMenu {
  return { sections: lay<"project">(commands, ROW_SECTIONS, () => true) };
}

/** The session header's menu, from `sessionCommands`' descriptors. */
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
 * - artifacts: listed only once the session published a Radius artifact (`sessionArtifacts`).
 * - session rail: side by side only (its facts need neither Git nor a live Pi); "Hide session
 *   rail" while the column shows, else "Show session rail". One area at a time it is not listed:
 *   the session menu holds the same facts.
 * - agent: the session is laid out one area at a time and the Agent tab shows, beside an open
 *   Surface tab.
 * - pull request, copy session ID: the selected session has a Pi session ID; a pull request is
 *   linked, read and unlinked in Changes, so it also follows Changes' rule and says why not.
 * - open, stop and details of the preview: listed only with the page's preview observation and
 *   while the selected session's live Pi owns an app (`seenPreview`); open needs its link, which
 *   an unanswered status read withholds, stop needs the attachment (`sessionReady`).
 * - new session here: the checkout is present.
 * - copy session path: saved history has supplied its file path; no live Pi needed.
 * - copy branch, commit SHA, repository name: listed only while the session has one.
 * - other copy commands, Wrap and Messages only: always (session ID requires an ID). Wrap is one
 *   remembered preference for Changes and a file's source, so it never depends on what is shown.
 */
export function sessionCommands(
  state: AppState,
  target?: SessionTarget,
  options: {
    messagesOnly?: boolean;
    codeWrap?: boolean;
    radiusSignedIn?: boolean;
    /** The session's layout as navigation has it; by default side by side with only Agent. */
    layout?: SessionLayout;
    /** The page's preview observation (`seenPreview`); without it no preview command is listed. */
    previewObservation?: Pick<PreviewObservationState, "unconfirmed">;
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
        // The header's control appears with the first artifact; until then there is nothing to grey.
        hidden: !hasArtifacts,
        intent: { kind: "artifacts" },
      },
      {
        id: "session-rail",
        label: rail ? "Hide session rail" : "Show session rail",
        icon: "list",
        enabled: !single,
        // One area at a time there is no rail: the header says where the session runs.
        hidden: single,
        keywords: ["details", "info", "outputs", "files", "branch"],
        intent: { kind: "session-rail" },
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
function previewCommands(
  state: AppState,
  observed: Pick<PreviewObservationState, "unconfirmed">,
): SessionCommand[] {
  const preview = seenPreview(state, observed);
  const claim = previewClaim(state);
  if (!preview || !claim) return [];
  return [
    {
      id: "show-preview",
      label: "Show preview",
      icon: "preview",
      enabled: true,
      keywords: ["app", "inspect"],
      intent: { kind: "show-preview" },
    },
    {
      id: "open-preview",
      label: "Open preview in new tab",
      icon: "preview",
      enabled: !!preview.url,
      // The symptom finds the recovery: the embedded page denies what a real tab allows.
      keywords: [
        "app",
        "run",
        "localhost",
        "not working",
        "can't click",
        "cant",
        "sign in",
        "popup",
      ],
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
      intent: {
        kind: "stop-preview",
        ...claim,
        host: preview.url ? previewHost(preview.url) : "this app",
      },
    },
  ];
}
