import type { ProjectTrust, ServerMessage } from "../../../../shared/wire.ts";
import type { TrustDecision } from "./state.ts";
import type { AppState } from "./state.ts";

export type TrustObservation = Extract<ServerMessage, { _tag: "trust" }>;

export function directoryTrust(state: AppState, cwd: string): ProjectTrust | undefined {
  return (
    state.trusts[cwd] ??
    state.folders.flatMap((f) => f.worktrees).find((w) => w.path === cwd)?.trust
  );
}

export function observeTrust(state: AppState, m: TrustObservation): AppState {
  return { ...state, trusts: { ...state.trusts, [m.cwd]: m.trust } };
}

export function pendingTrust(state: AppState, cwd: string): TrustDecision | undefined {
  return state.trustDecisions.find((d) => d.cwd === cwd && d.status === "pending");
}

export function displayedTrust(state: AppState, cwd: string): ProjectTrust | undefined {
  const pending = pendingTrust(state, cwd);
  return pending ? pending.shown : directoryTrust(state, cwd);
}

export function canDecideTrust(state: AppState, cwd: string): boolean {
  return state.connected && !pendingTrust(state, cwd);
}
