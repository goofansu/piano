/**
 * The session-dispatch contract between Piano's bundled extension (which registers the tools and
 * records the backlink), the server (which launches the child and reads its history) and the
 * browser (which renders the tool calls). Each side imports these names rather than spelling
 * them, so a renamed tool or a new status fails the type check instead of drifting.
 */

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

/** Pi's custom entry naming the session that dispatched this one; never part of model context. */
export const DISPATCH_ENTRY = "piano.dispatch";
/** Piano passes it when it creates a dispatched session, and only then. */
export const DISPATCHED_FROM_FLAG = "piano-dispatched-from";

/** The launch environment that tells the extension how to reach the Piano that spawned it. */
export const SESSION_WS_URL = "PIANO_SESSION_WS_URL";
export const SESSION_ORIGIN = "PIANO_SESSION_ORIGIN";
