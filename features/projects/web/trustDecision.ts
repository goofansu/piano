import type { ProjectTrust, ServerMessage } from "../../../shared/wire.ts";
import type { Notify, NotifyLevel } from "../../../web/src/shared/state/client.ts";
import { canDecideTrust } from "../../../web/src/shared/state/directoryTrust.ts";
import {
  directoryTrust,
  type TrustObservation,
} from "../../../web/src/shared/state/directoryTrust.ts";
import type { TrustDecision, TrustDecisionAction } from "../../../web/src/shared/state/state.ts";
import type { AppState } from "../../../web/src/shared/state/state.ts";
import {
  type CorrelatedRequestOptions,
  correlatedRequests,
  type RequestOutcome,
} from "../../../web/src/shared/transport/correlatedRequest.ts";

type TrustAnswer = { status: "ok"; trust: ProjectTrust } | { status: "error"; message: string };

export function reduceTrustDecision(state: AppState, a: TrustDecisionAction): AppState {
  if (a.type === "trust_decision")
    return {
      ...state,
      trustDecisions: [
        ...state.trustDecisions.filter((d) => d.cwd !== a.cwd),
        {
          cwd: a.cwd,
          requestId: a.requestId,
          trusted: a.trusted,
          shown: directoryTrust(state, a.cwd),
          status: "pending",
        },
      ],
    };
  const decision = state.trustDecisions.find((d) => d.requestId === a.requestId);
  if (!decision) return state;
  return {
    ...state,
    trustDecisions: a.unconfirmed
      ? state.trustDecisions.map((d) =>
          d === decision ? { ...d, status: "unconfirmed" as const } : d,
        )
      : state.trustDecisions.filter((d) => d !== decision),
  };
}

const explains = (d: TrustDecision, m: TrustObservation) =>
  d.cwd === m.cwd && (d.status === "pending" || d.trusted === m.trust.trusted);

export function trustObserved(state: AppState, m: TrustObservation): AppState {
  const resolved = (d: TrustDecision) => d.status === "unconfirmed" && explains(d, m);
  return state.trustDecisions.some(resolved)
    ? { ...state, trustDecisions: state.trustDecisions.filter((d) => !resolved(d)) }
    : state;
}

export function trustNotice(
  state: AppState,
  focusedCwd: string | undefined,
  m: TrustObservation,
): string | undefined {
  if (m.requestId !== undefined || m.cwd !== focusedCwd) return undefined;
  if (state.trustDecisions.some((d) => explains(d, m))) return undefined;
  const displayed = directoryTrust(state, m.cwd);
  if (!m.trust.required || !displayed?.required || displayed.trusted === m.trust.trusted)
    return undefined;
  return `Pi marked this folder as ${m.trust.trusted ? "trusted" : "untrusted"}.`;
}

const receipt = (m: ServerMessage): { requestId: string; result: TrustAnswer } | undefined => {
  if (m._tag === "trust_failed")
    return { requestId: m.requestId, result: { status: "error", message: m.message } };
  if (m._tag === "trust" && m.requestId !== undefined)
    return { requestId: m.requestId, result: { status: "ok", trust: m.trust } };
  return undefined;
};

function decisionNotice(
  trusted: boolean,
  outcome: RequestOutcome<TrustAnswer>,
): { message: string; level: NotifyLevel } | undefined {
  const failed = `Could not ${trusted ? "trust" : "untrust"} folder`;
  const unconfirmed = `${trusted ? "Trust" : "Untrust"} folder may have finished; check the folder's trust`;
  switch (outcome.status) {
    case "confirmed":
      return undefined;
    case "not-sent":
      return { message: failed, level: "error" };
    case "failed":
      return { message: `${failed}: ${outcome.error.message}`, level: "error" };
    case "unconfirmed":
      return {
        message:
          outcome.reason === "connection-lost"
            ? `Connection lost. ${unconfirmed} after reconnecting.`
            : `No reply. ${unconfirmed}.`,
        level: "warning",
      };
  }
}

export interface TrustDecisionsOptions extends CorrelatedRequestOptions {
  notify: Notify;
  dispatch: (action: TrustDecisionAction) => void;
}

export function createTrustDecisions({ notify, dispatch, ...options }: TrustDecisionsOptions) {
  const { client } = options;
  const requests = correlatedRequests(options);
  return (path: string, trusted: boolean): void => {
    if (!canDecideTrust(client.getState(), path)) return;
    let requestId = "";
    requests.send<TrustAnswer>({
      command: (id) => ({ _tag: "set_trust", requestId: id, path, trusted }),
      receipt,
      pending: (id) => {
        requestId = id;
        dispatch({ type: "trust_decision", cwd: path, requestId: id, trusted });
      },
      settle: (outcome) => {
        dispatch({
          type: "trust_settled",
          requestId,
          unconfirmed: outcome.status === "unconfirmed",
        });
        const notice = decisionNotice(trusted, outcome);
        if (notice) notify(notice.message, notice.level);
      },
    });
  };
}
