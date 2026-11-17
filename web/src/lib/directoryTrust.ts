import type { ProjectTrust, ServerMessage } from "../../../shared/wire.ts";
import type { AppState } from "../store.ts";

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
