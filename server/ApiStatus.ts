import type { ApiStatus } from "../shared/api.ts";
import type { Dialog, SessionState, Snapshot } from "../shared/wire.ts";

/** Pi retains the last acknowledgement after settling; it is no longer an active submission. */
export const snapshotStatus = ({ state, dialogs }: Snapshot, hosted: boolean) =>
  deriveStatus(
    state.isQuiescent && ["started", "queued"].includes(state.submission?.outcome ?? "")
      ? { ...state, submission: undefined }
      : state,
    dialogs,
    hosted,
  );

/** Execution status, not task success. Error and dialog facts take precedence over activity. */
export function deriveStatus(
  state: SessionState,
  dialogs: ReadonlyArray<Dialog>,
  hosted: boolean,
): { status: ApiStatus; detail: string | null } {
  if (state.closure && state.closure._tag !== "released")
    return { status: "error", detail: state.closure.detail };
  if (state.projectionError) return { status: "error", detail: state.projectionError };
  if (state.submission?.outcome === "rejected")
    return { status: "error", detail: state.submission.detail ?? "Prompt was rejected." };
  if (dialogs.length > 0)
    return { status: "waiting", detail: dialogs[0].title ?? dialogs[0].message ?? null };
  if (
    hosted &&
    (state.isStreaming ||
      state.isCompacting ||
      state.isRetrying ||
      state.isStopping ||
      (state.queuedMessages?.length ?? 0) > 0 ||
      ["submitting", "started", "queued"].includes(state.submission?.outcome ?? "") ||
      state.isQuiescent === false)
  )
    return { status: "running", detail: null };
  return { status: "idle", detail: null };
}
