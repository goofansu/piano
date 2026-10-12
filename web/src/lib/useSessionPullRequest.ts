import type { SessionPullRequest, SessionPullRequestAction } from "@shared/wire";
import { toast } from "sonner";
import { sessionPullRequest } from "@/lib/api";
import { useObservation } from "@/lib/useObservation";

const POLL_MS = 60_000;
const failure = (error: unknown) =>
  error instanceof Error ? error.message : "Could not load the pull request.";
/** An unreadable pull request keeps the session's saved link and discovery choice, with the reason. */
const fallback = (previous: SessionPullRequest | undefined, error: string): SessionPullRequest => ({
  link: previous?.link ?? null,
  pullRequest: null,
  discovery: previous?.discovery ?? true,
  error,
});

/** Only the selected session is observed: on selection, focus, a minute's interval and when its work starts or stops. */
export function useSessionPullRequest(
  workspaceId: string | undefined,
  sessionId: string | null | undefined,
  working: boolean,
) {
  const key = workspaceId && sessionId ? JSON.stringify([workspaceId, sessionId]) : null;
  const observation = useObservation<SessionPullRequest>(
    key,
    (signal) => sessionPullRequest(workspaceId!, sessionId!, undefined, { signal }),
    { focus: true, interval: () => POLL_MS, trigger: working },
  );
  const value = observation.error
    ? fallback(observation.value, observation.error)
    : observation.value;
  /** Reads refresh facts silently; only an explicit change blocks the controls. Resolves with the saved state, or `false`. */
  const change = async (action: SessionPullRequestAction): Promise<SessionPullRequest | false> => {
    let failed = false;
    const body = await observation
      .mutate(async (signal, previous) => {
        try {
          const body = await sessionPullRequest(workspaceId!, sessionId!, action, { signal });
          // A saved association can succeed even when its live GitHub status is unavailable.
          if (body.error) toast.error(body.error);
          return body;
        } catch (error) {
          if (signal.aborted) throw error;
          failed = true;
          toast.error(failure(error));
          return fallback(previous, failure(error));
        }
      })
      .catch(() => undefined);
    return body && !failed ? body : false;
  };
  return { value, busy: observation.mutating, refresh: () => observation.refresh(), change };
}
