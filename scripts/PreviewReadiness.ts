/**
 * Nested budgets for preview operations. Readiness follows Kamal's proxy healthcheck approach:
 * periodic GETs with a per-request deadline, separate from the caller's readiness wait.
 *
 * Ready means an owned loopback listener returns 2xx/3xx for the preview Host. A cold app may
 * return 4xx/5xx or not listen yet; until it has been ready once, a starting/running app counts as
 * warming for WARMUP_SECONDS. The owner keeps checking after the caller's wait ends.
 *
 * The account-wide lock is released between checks, so one app's readiness wait does not block
 * other workspaces. The client's observation budget must cover lock acquisition, the longest
 * readiness wait and the surrounding stop/submission/check work.
 */
export const READY_INTERVAL_MS = 1000;
export const READY_REQUEST_TIMEOUT_MS = 5000;
/** How long a start waits for readiness unless `timeoutSeconds` says otherwise, and its bounds. */
export const START_TIMEOUT_SECONDS = { default: 30, min: 1, max: 90 } as const;
/** Warm-up window from launch, only for an app that has never been ready. */
export const WARMUP_SECONDS = 600;
/** How long a preview operation waits for the account-wide lock before it reports busy. */
export const LOCK_WAIT_MS = 65_000;
/** Room for a start's bounded steps around its waits: a stop, a submission, a last check. */
const STEPS_MS = 30_000;
/** Losing the client reply ends observation, not the admitted operation. */
export const OBSERVATION_TIMEOUT_MS = LOCK_WAIT_MS + START_TIMEOUT_SECONDS.max * 1000 + STEPS_MS;
