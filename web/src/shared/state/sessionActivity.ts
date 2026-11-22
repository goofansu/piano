import { workUnderWay } from "../../../../shared/session/sessionStatus.ts";
import { type HostInfo, sameSession } from "../../../../shared/wire.ts";
import { type AppState, isSession, sessionKey } from "./state.ts";

export type HostActivity = "starting" | "working" | "idle" | "unknown" | "off";

export function hostActivity(host: HostInfo | undefined, current: boolean): HostActivity {
  if (!host) return "off";
  if (host.starting) return "starting";
  if (host.working) return current ? "working" : "unknown";
  return current ? "idle" : "off";
}

export function finishedTurns(
  state: Pick<AppState, "hosts" | "done" | "session" | "selecting">,
  next: readonly HostInfo[],
): string[] {
  const watched = state.session ?? state.selecting;
  const viewing = watched ? sessionKey(watched) : null;
  const finished = new Set(state.done);
  for (const before of state.hosts) {
    if (!before.working) continue;
    const after = next.find((h) => sameSession(h, before));
    const key = sessionKey(before);
    if (after && !after.working && key !== viewing) finished.add(key);
  }
  return [...finished];
}

export function sessionWorking(
  state: Pick<AppState, "session" | "hosts" | "hostsCurrent">,
  target: { cwd: string; sessionId: string },
): boolean {
  const session = state.session;
  if (session && isSession(session, target)) return workUnderWay(session.state);
  const activity = hostActivity(
    state.hosts.find((host) => sameSession(host, target)),
    state.hostsCurrent,
  );
  return activity === "working" || activity === "unknown";
}

export function anySessionWorking(state: Pick<AppState, "hosts" | "hostsCurrent">): boolean {
  return state.hosts.some((h) => hostActivity(h, state.hostsCurrent) === "working");
}
