/**
 * The session-dispatch contract between Piano's bundled extension (which registers the tools and
 * records the backlink), the server (which launches the child and reads its history) and the
 * browser (which renders the tool calls). Each side imports these names and shapes rather than
 * spelling them, so a renamed tool, field or status fails the type check instead of drifting.
 */
import type { ThinkingLevel } from "./wire.ts";

export const START_TOOL = "piano_start_session";
export const WAIT_TOOL = "piano_wait_sessions";

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
  /** Identifies the brief even when admission arrives before its user message. */
  readonly inputFingerprint: string;
  /** The user message this prompt produced, when it arrived before the start returned. */
  readonly anchorMessageId: string | null;
}

/** Whether the session exists. "refused" started nothing; "uncertain" may have started everything. */
export type SessionCreation = "created" | "refused" | "uncertain";

export interface StartResult {
  readonly cwd: string;
  readonly creation: SessionCreation;
  readonly submission: SessionSubmission;
  /** Present exactly when `creation` is "created". */
  readonly handle: SessionHandle | null;
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
  /** Defaults to the dispatching session's checkout. */
  readonly cwd?: string;
  readonly model?: string;
  readonly thinkingLevel?: ThinkingLevel;
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

/** Pi's custom entry naming the session that dispatched this one; never part of model context. */
export const DISPATCH_ENTRY = "piano.dispatch";
/** Piano passes it when it creates a dispatched session, and only then. */
export const DISPATCHED_FROM_FLAG = "piano-dispatched-from";

/** The launch environment that tells the extension how to reach the Piano that spawned it. */
export const SESSION_WS_URL = "PIANO_SESSION_WS_URL";
export const SESSION_ORIGIN = "PIANO_SESSION_ORIGIN";
