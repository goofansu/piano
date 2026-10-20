/**
 * Directory trust as the browser shows it: Pi's latest observation per directory, the decision
 * the person has in flight, and when a change merits telling them. The store, the client and the
 * trust command read and change trust only through here.
 */
// Relative, not @shared: module tests load this file directly in Node.
import type { ProjectTrust, ServerMessage } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";

/** A decision awaiting its reply, with the trust displayed when it was sent. */
export interface PendingTrust {
  cwd: string;
  trust: ProjectTrust | undefined;
}

type TrustFrame = Extract<ServerMessage, { _tag: "trust" | "trust_failed" }>;

/** Pi's trust outcome for a directory: the latest probe, else what discovery recorded for a known worktree. */
export function directoryTrust(state: AppState, cwd: string): ProjectTrust | undefined {
  return (
    state.trusts[cwd] ??
    state.folders.flatMap((f) => f.worktrees).find((w) => w.path === cwd)?.trust
  );
}

export function pendingTrust(state: AppState, cwd: string): PendingTrust | undefined {
  return state.pendingTrust.find((pending) => pending.cwd === cwd);
}

/**
 * The trust to display for `cwd`. An in-flight decision keeps its pre-click display, since probes
 * that race it are not its answer; live observations still update underneath.
 */
export function displayedTrust(state: AppState, cwd: string): ProjectTrust | undefined {
  const pending = pendingTrust(state, cwd);
  return pending ? pending.trust : directoryTrust(state, cwd);
}

/** Whether a decision about `cwd` may be sent now: connected, and none already in flight. */
export function canDecideTrust(state: AppState, cwd: string): boolean {
  return state.connected && !pendingTrust(state, cwd);
}

/** Records a sent decision. */
export function beginTrustDecision(state: AppState, cwd: string): AppState {
  return {
    ...state,
    pendingTrust: [...state.pendingTrust, { cwd, trust: directoryTrust(state, cwd) }],
  };
}

/**
 * Applies a trust frame. Only a decision's own reply, success or failure, settles it; a probe
 * records its observation and leaves the decision pending.
 */
export function applyTrustFrame(state: AppState, m: TrustFrame): AppState {
  const settled = m._tag === "trust_failed" || m.requested !== undefined;
  return {
    ...state,
    trusts: m._tag === "trust" ? { ...state.trusts, [m.cwd]: m.trust } : state.trusts,
    pendingTrust: settled
      ? state.pendingTrust.filter((pending) => pending.cwd !== m.cwd)
      : state.pendingTrust,
  };
}

/** A lost connection drops every decision's reply; their controls reveal the latest observation. */
export function dropTrustDecisions(state: AppState): AppState {
  return state.pendingTrust.length ? { ...state, pendingTrust: [] } : state;
}

/**
 * The notice a trust frame deserves before it is applied: only a change Pi made by itself to the
 * directory on screen. First results, other directories and the person's own decisions, which
 * keep their confirmation, stay quiet.
 */
export function trustNotice(
  state: AppState,
  focusedCwd: string | undefined,
  m: TrustFrame,
): string | undefined {
  if (m._tag !== "trust" || m.requested !== undefined || m.cwd !== focusedCwd) return undefined;
  if (pendingTrust(state, m.cwd)) return undefined;
  const displayed = directoryTrust(state, m.cwd);
  if (!m.trust.required || !displayed?.required || displayed.trusted === m.trust.trusted)
    return undefined;
  return `Pi marked this folder as ${m.trust.trusted ? "trusted" : "untrusted"}.`;
}
