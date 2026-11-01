/**
 * Preview budgets, which must nest, in one place.
 *
 * Readiness, after Kamal's proxy healthcheck: one GET every interval, each bounded by its own
 * request timeout, separate from how long a start waits. A cold app (migrations, asset
 * compilation) may answer 5xx/4xx or not at all for minutes; while it has never answered and its
 * process runs, it is warming up, not failed, and the owner keeps checking for the warm-up window.
 *
 * The account-wide lock is held for one bounded step at a time (a stop, a submission, one
 * readiness check), never across a start's readiness wait, so its wait does not depend on how long
 * any start waits. A client's wait covers a start's lock wait and then its whole readiness wait.
 */
export const READY_INTERVAL_MS = 1000;
export const READY_REQUEST_TIMEOUT_MS = 5000;
/** How long a start waits for readiness unless `timeoutSeconds` says otherwise, and its bounds. */
export const START_TIMEOUT_SECONDS = { default: 30, min: 1, max: 90 } as const;
/** How long after launch a running app that never answered counts as warming up. */
export const WARMUP_SECONDS = 600;
/** How long a preview operation waits for the account-wide lock before it reports busy. */
export const LOCK_WAIT_MS = 65_000;
/** Room for a start's bounded steps around its waits: a stop, a submission, a last check. */
const STEPS_MS = 30_000;
/** How long a client waits for the owner's answer: the longest start's lock wait, then its
 * readiness wait, then its steps. Losing the answer never cancels the admitted operation. */
export const OBSERVATION_TIMEOUT_MS = LOCK_WAIT_MS + START_TIMEOUT_SECONDS.max * 1000 + STEPS_MS;
