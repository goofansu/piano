import type { SessionStatusFacts, WorktreeRequest } from "./wire.ts";

export type { SessionStatusFacts, WorktreeRequest };

export const START_TOOL = "piano_start_session";
export const WAIT_TOOL = "piano_wait_sessions";
export const STATUS_TOOL = "piano_session_status";

export type SessionSubmission =
  | "started"
  | "queued"
  | "handled"
  | "rejected"
  | "uncertain"
  | "needs_input"
  | "not_sent";

export const WAIT_STATUSES = [
  "running",
  "settled",
  "failed",
  "cancelled",
  "needs_input",
  "unknown",
] as const;
export type WaitStatus = (typeof WAIT_STATUSES)[number];

export interface SessionHandle {
  readonly cwd: string;
  readonly sessionId: string;
  readonly generation: string;
  readonly submissionId: number | null;
  readonly baselineMessages: number;
  readonly baselineFingerprint: string;
  readonly inputFingerprint: string;
  readonly anchorMessageId: string | null;
}

export type SessionCreation = "created" | "refused" | "uncertain";

export interface CreatedWorktree {
  readonly path: string;
  readonly branch: string;
}

export interface StartResult {
  readonly cwd: string;
  readonly creation: SessionCreation;
  readonly submission: SessionSubmission;
  readonly handle: SessionHandle | null;
  readonly worktree: CreatedWorktree | null;
  readonly detail?: string;
}

export type WaitEnding = "observed" | "deadline" | "aborted";

export type Attribution = "attributed" | "no-output" | "unattributable";

export interface SessionObservation {
  readonly handle: SessionHandle;
  readonly status: WaitStatus;
  readonly ending: WaitEnding;
  readonly answer: string | null;
  readonly attribution: Attribution;
  readonly detail?: string;
}

export interface StartArguments {
  readonly prompt: string;
  readonly cwd?: string;
  readonly worktree?: WorktreeRequest;
  readonly inheritProject?: boolean;
}

export interface WaitArguments {
  readonly sessions: SessionHandle[];
  readonly timeoutMs?: number;
}

export interface StartToolResult extends StartResult {
  readonly link: string | null;
}

export interface WaitToolResult {
  readonly results: (SessionObservation & { readonly link: string })[];
}

export interface StatusArguments {
  readonly sessionId: string;
}

export const DISPOSITIONS = ["running", "needs_input", "settled", "exited", "unknown"] as const;
export type Disposition = (typeof DISPOSITIONS)[number];

export const LAST_ANSWER_CHARS = 2000;
export const STATUS_CHANGES_MS = 10_000;
export const STATUS_DEADLINE_MS = 30_000;

export interface SessionStatus extends Omit<SessionStatusFacts, "needs"> {
  readonly link: string;
  readonly needs: (NonNullable<SessionStatusFacts["needs"]> & { readonly link: string }) | null;
}

export type FollowUpDelivery = "follow-up" | "steer";

export interface FollowUpResult {
  readonly sessionId: string;
  readonly delivery: FollowUpDelivery;
  readonly submission: SessionSubmission;
  readonly detail?: string;
}

export const DISPATCH_ENTRY = "piano.dispatch";
export const DISPATCHED_FROM_FLAG = "piano-dispatched-from";

export const SESSION_WS_URL = "PIANO_SESSION_WS_URL";
export const SESSION_ORIGIN = "PIANO_SESSION_ORIGIN";
export const PROJECT_INSTRUCTIONS_ENV = "PIANO_PROJECT_INSTRUCTIONS";
export const PROJECT_INSTRUCTIONS_SECTION = "project_instructions";
export const LAUNCH_ENV = [SESSION_WS_URL, SESSION_ORIGIN, PROJECT_INSTRUCTIONS_ENV] as const;
export type LaunchEnv = Partial<Record<(typeof LAUNCH_ENV)[number], string>>;
