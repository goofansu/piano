/**
 * The session-dispatch contract between Piano's bundled extension (which registers the tools and
 * records the backlink), the server (which launches the child and reads its history) and the
 * browser (which renders the tool calls). Each side imports these names and shapes rather than
 * spelling them, so a renamed tool, field or status fails the type check instead of drifting.
 */
import type { SessionStatusFacts, WorktreeRequest } from "./wire.ts";

/** A new worktree for the session: a new branch created through Worktrunk, as on the New page.
 * `hooks` runs approved Worktrunk hooks (unapproved ones refuse creation); off by default. */
export type { SessionStatusFacts, WorktreeRequest };

export const START_TOOL = "piano_start_session";
export const WAIT_TOOL = "piano_wait_sessions";
export const STATUS_TOOL = "piano_session_status";

/** What became of the first prompt, in Pi's own submission words. */
export type SessionSubmission =
  | "started"
  | "queued"
  | "handled"
  | "rejected"
  | "uncertain"
  | "waiting_for_input"
  | "not_sent";

/** What the session was doing when observation stopped; never a judgement of the work's quality.
 * A value list as well as a type: the wait tool's output schema enumerates it. */
export const WAIT_STATUSES = [
  "running",
  "settled",
  "failed",
  "cancelled",
  "waiting_for_input",
  "unknown",
] as const;
export type WaitStatus = (typeof WAIT_STATUSES)[number];

/**
 * Everything a later wait needs, and nothing a model cannot read back: it is JSON the tool result
 * carries through the conversation. The attribution facts are bounded — a digest and two ids,
 * never a copy of the transcript.
 */
export interface SessionHandle {
  /** Piano's own spelling of the directory, as it reported it; a wait addresses the session with it. */
  readonly cwd: string;
  readonly sessionId: string;
  /** The child incarnation that took the prompt. A restarted Pi cannot answer for it. */
  readonly generation: string;
  /** Submission id within that incarnation; null when Pi never acknowledged the input. */
  readonly submissionId: number | null;
  /** Transcript length when the session was created, before the prompt was sent. */
  readonly baselineMessages: number;
  /** Digest of the prefix's content, not positional ids which compaction can reuse. */
  readonly baselineFingerprint: string;
  /** Server-issued, process-keyed equality evidence for the raw brief (with Pi skill normalization).
   * Empty means unavailable. Never reconstruct it from display text. */
  readonly inputFingerprint: string;
  /** The user message this prompt produced, when it arrived before the start returned. */
  readonly anchorMessageId: string | null;
}

/** Whether the session exists. "refused" started nothing; "uncertain" may have started everything. */
export type SessionCreation = "created" | "refused" | "uncertain";

/** The worktree Piano created and placed the session in. */
export interface CreatedWorktree {
  readonly path: string;
  readonly branch: string;
}

export interface StartResult {
  readonly cwd: string;
  readonly creation: SessionCreation;
  readonly submission: SessionSubmission;
  /** Present exactly when `creation` is "created". */
  readonly handle: SessionHandle | null;
  /** The worktree the session was placed in, when the start asked for one and the session exists. */
  readonly worktree: CreatedWorktree | null;
  readonly detail?: string;
}

/** Why observation stopped, kept apart from what was observed. */
export type WaitEnding = "observed" | "deadline" | "aborted";

export type Attribution = "attributed" | "no-output" | "unattributable";

export interface SessionObservation {
  readonly handle: SessionHandle;
  readonly status: WaitStatus;
  readonly ending: WaitEnding;
  /** The assistant text this handle's input produced, or null when it cannot be attributed. */
  readonly answer: string | null;
  readonly attribution: Attribution;
  readonly detail?: string;
}

/** The start tool's arguments, as the model sends them. */
export interface StartArguments {
  readonly prompt: string;
  /** Defaults to the dispatching session's checkout. With `worktree`, the checkout to branch from. */
  readonly cwd?: string;
  /** Create a new worktree from `cwd`'s repository and start the session there. */
  readonly worktree?: WorktreeRequest;
}

/** The wait tool's arguments: handles exactly as a start returned them. */
export interface WaitArguments {
  readonly sessions: SessionHandle[];
  readonly timeoutMs?: number;
}

/** The start tool's result JSON: the start's outcome and the session's Piano link, once it has one. */
export interface StartToolResult extends StartResult {
  readonly link: string | null;
}

/** The wait tool's result JSON: one observation per handle, in the order they were given. */
export interface WaitToolResult {
  readonly results: (SessionObservation & { readonly link: string })[];
}

/** The status tool's arguments: a session Piano lists, by its ID. */
export interface StatusArguments {
  readonly sessionId: string;
}

/**
 * What a session is doing, from what Piano holds now. `settled` is execution stopped, never task
 * success (INV-03): for a live session, the host's published quiescence; `exited` is a Pi child
 * that stopped without settling; `unknown` is a session whose live facts are gone (Piano
 * restarted) and whose history proves no ending, or an idle one whose last input or dialog answer
 * Piano could not confirm delivering.
 */
export const DISPOSITIONS = ["running", "needs_input", "settled", "exited", "unknown"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

/** How many characters of the last answer a status carries. */
export const LAST_ANSWER_CHARS = 2000;
/** How long one status read gives Git and GitHub for its sessions' `changes`, all together; a
 * session whose Git view is not read by then carries `changes: null` beside its other facts. */
export const STATUS_CHANGES_MS = 10_000;
/** A status read waits this long for Piano's answer: the changes budget, and the rest. */
export const STATUS_DEADLINE_MS = 30_000;

/** A status as the tool and the script report it. */
export interface SessionStatus extends Omit<SessionStatusFacts, "needs"> {
  readonly link: string;
  readonly needs: (NonNullable<SessionStatusFacts["needs"]> & { readonly link: string }) | null;
}

/** How a message reaches a session, as the composer offers it: `follow-up` waits for the current
 * run to finish (or starts one when Pi is idle); `steer` is delivered at Pi's next tool boundary. */
export type FollowUpDelivery = "follow-up" | "steer";

/** A follow-up's result: Pi's handling of the message, in the start's submission words. `not_sent`
 * means Piano never received it; `uncertain` means it may have reached Pi, so read the session's
 * status before sending again. */
export interface FollowUpResult {
  readonly sessionId: string;
  readonly delivery: FollowUpDelivery;
  readonly submission: Exclude<SessionSubmission, "waiting_for_input">;
  readonly detail?: string;
}

/** Pi's custom entry naming the session that dispatched this one; never part of model context. */
export const DISPATCH_ENTRY = "piano.dispatch";
/** Piano passes it when it creates a dispatched session, and only then. */
export const DISPATCHED_FROM_FLAG = "piano-dispatched-from";

/** The launch environment that tells the extension how to reach the Piano that spawned it. */
export const SESSION_WS_URL = "PIANO_SESSION_WS_URL";
export const SESSION_ORIGIN = "PIANO_SESSION_ORIGIN";
/** The session's project instructions, set for each launch of a project member's Pi. */
export const PROJECT_INSTRUCTIONS_ENV = "PIANO_PROJECT_INSTRUCTIONS";
/** The system prompt section the extension puts them in. */
export const PROJECT_INSTRUCTIONS_SECTION = "project_instructions";
/** The session's preview owner endpoint, set for each launch where previews are supported. */
export const PREVIEW_OWNER_ENV = "PIANO_PREVIEW_OWNER";
/**
 * Every variable Piano sets for a launch of Pi. No child of Piano inherits them
 * (`server/ChildEnvironment.ts`): a spawned Pi gets only what its own launch sets, so a Piano
 * started inside another session never passes on that parent's values.
 */
export const LAUNCH_ENV = [
  SESSION_WS_URL,
  SESSION_ORIGIN,
  PREVIEW_OWNER_ENV,
  PROJECT_INSTRUCTIONS_ENV,
] as const;
export type LaunchEnv = Partial<Record<(typeof LAUNCH_ENV)[number], string>>;
