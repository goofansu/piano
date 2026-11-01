/**
 * PreviewProjection: what one live Pi generation's preview owner has observed, as the browser's
 * `SessionPreview`. Folds each admitted request's adapter outcome, from the session's own tool or
 * from the browser, into the last observation. Internal to PiSessions.
 */
import type { PreviewRequest } from "../scripts/PreviewAdapter.ts";
import { generationApp, type PreviewOutcome } from "../scripts/PreviewOwner.ts";
import { PREVIEW_STATES, type SessionPreview } from "../shared/wire.ts";

const text = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** An app observation that belongs to `generation`, or undefined for any other result. A launch
 * intent without an observation is in an `unknown` state. */
function observed(app: unknown, generation: string): SessionPreview | undefined {
  const result = generationApp(app, generation);
  if (!result) return undefined;
  const state = [...PREVIEW_STATES, "unknown" as const].find((s) => s === result.state);
  const spec = isRecord(result.spec) ? result.spec : undefined;
  if (!state) return undefined;
  const ready = result.ready === true;
  return {
    instanceId: result.instanceId,
    state,
    ready,
    warming: !ready && result.warming === true,
    url: ready && typeof result.url === "string" ? result.url : null,
    port: typeof result.port === "number" ? result.port : 0,
    command: Array.isArray(spec?.command) ? spec.command.map(String) : [],
    detail: [result.launchError, result.detail].filter((d) => typeof d === "string").join(" "),
    externalAccess: result.externalAccess === "same-host" ? "same-host" : "unverified",
    observedAt: typeof result.observedAt === "number" ? result.observedAt : Date.now() / 1000,
  };
}

/**
 * The preview after `request` ended with `outcome`. An observation of this generation's app
 * replaces it; another owner's app or an absent record is not this session's preview; a confirmed
 * stop of the current instance clears it. A failed observation makes the current app, or the one a
 * failed start launched, unknown rather than stopped. A failed or refused start (an ownership
 * conflict) arrives as the status read that followed it.
 */
export function projectPreview(
  current: SessionPreview | undefined,
  generation: string,
  request: Pick<PreviewRequest, "action">,
  outcome: PreviewOutcome,
): SessionPreview | undefined {
  if ("error" in outcome) {
    const app =
      (isRecord(outcome.attempted) &&
        observed({ ...outcome.attempted, state: "unknown" }, generation)) ||
      current;
    if (!app) return undefined;
    return {
      ...app,
      state: "unknown",
      ready: false,
      warming: false,
      url: null,
      detail: text(outcome.error),
      observedAt: Date.now() / 1000,
    };
  }
  const { result } = outcome;
  const app = observed(result, generation);
  if (app) return app;
  if (!isRecord(result)) return current;
  if (result.status === "absent") return undefined;
  if (result.status === "stopped" || result.status === "cleared")
    return current?.instanceId === result.instanceId ? undefined : current;
  // A status naming another owner's app: this session has none in its workspace.
  if (request.action === "status" && typeof result.instanceId === "string") return undefined;
  return current;
}

/** Logs from a status observation of this generation's app; another owner's logs are not shown. */
export function previewLogs(result: unknown, generation: string) {
  const app = observed(result, generation);
  return {
    instanceId: app?.instanceId ?? null,
    logs: app && isRecord(result) && typeof result.logs === "string" ? result.logs : "",
  };
}
