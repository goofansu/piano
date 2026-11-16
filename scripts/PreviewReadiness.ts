export const READY_INTERVAL_MS = 1000;
export const READY_REQUEST_TIMEOUT_MS = 5000;
export const START_TIMEOUT_SECONDS = { default: 30, min: 1, max: 90 } as const;
export const WARMUP_SECONDS = 600;
export const LOCK_WAIT_MS = 65_000;
const STEPS_MS = 30_000;
export const OBSERVATION_TIMEOUT_MS = LOCK_WAIT_MS + START_TIMEOUT_SECONDS.max * 1000 + STEPS_MS;
