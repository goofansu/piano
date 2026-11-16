import type { ProjectTrust, ServerMessage } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";

export interface PendingTrust {
  cwd: string;
  trust: ProjectTrust | undefined;
}

type TrustFrame = Extract<ServerMessage, { _tag: "trust" | "trust_failed" }>;

export function directoryTrust(state: AppState, cwd: string): ProjectTrust | undefined {
  return (
    state.trusts[cwd] ??
    state.folders.flatMap((f) => f.worktrees).find((w) => w.path === cwd)?.trust
  );
}

export function pendingTrust(state: AppState, cwd: string): PendingTrust | undefined {
  return state.pendingTrust.find((pending) => pending.cwd === cwd);
}

export function displayedTrust(state: AppState, cwd: string): ProjectTrust | undefined {
  const pending = pendingTrust(state, cwd);
  return pending ? pending.trust : directoryTrust(state, cwd);
}

export function canDecideTrust(state: AppState, cwd: string): boolean {
  return state.connected && !pendingTrust(state, cwd);
}

export function beginTrustDecision(state: AppState, cwd: string): AppState {
  return {
    ...state,
    pendingTrust: [...state.pendingTrust, { cwd, trust: directoryTrust(state, cwd) }],
  };
}

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

export function dropTrustDecisions(state: AppState): AppState {
  return state.pendingTrust.length ? { ...state, pendingTrust: [] } : state;
}

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
