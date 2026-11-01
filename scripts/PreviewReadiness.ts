/**
 * Readiness, after Kamal's proxy healthcheck: one GET every interval, each bounded by its own
 * request timeout, separate from how long a start waits. A cold app (migrations, asset
 * compilation) may answer 5xx/4xx or not at all for minutes; while it has never answered and its
 * process runs, it is warming up, not failed, and the owner keeps checking for the warm-up window.
 */
export const READY_INTERVAL_MS = 1000;
export const READY_REQUEST_TIMEOUT_MS = 5000;
/** How long a start waits for readiness unless `timeoutSeconds` says otherwise, and its bounds.
 * The upper bound stays under the session client's 120s observation deadline. */
export const START_TIMEOUT_SECONDS = { default: 30, min: 1, max: 90 } as const;
/** How long after launch a running app that never answered counts as warming up. */
export const WARMUP_SECONDS = 600;
