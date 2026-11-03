/**
 * PreviewProjection: what one live Pi generation's preview owner has observed, as the browser's
 * `SessionPreview`. Folds each admitted request's adapter outcome, from the session's own tool or
 * from the browser, into the last observation. Internal to PiSessions.
 */
import type { PreviewRequest } from "../scripts/PreviewAdapter.ts";
import { type GenerationApp, observeApp, type PreviewOutcome } from "../scripts/PreviewOwner.ts";
import { PREVIEW_STATES, type SessionPreview } from "../shared/wire.ts";

const text = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** This generation's app as the browser's preview; undefined for a state it cannot show. A launch
 * intent without an observation is in an `unknown` state. */
function shown(result: GenerationApp): SessionPreview | undefined {
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

/** An app observation that belongs to `generation`, or undefined for any other result. */
function observed(result: unknown, generation: string): SessionPreview | undefined {
  const seen = observeApp(generation, { action: "status" }, { result });
  return seen.kind === "app" ? shown(seen.app) : undefined;
}

/**
 * The preview after `request` ended with `outcome`, read as the owner's warming checks read it
 * (`observeApp`). An observation of this generation's app replaces it; the app gone (an absent
 * record, another owner's app, a confirmed stop of the current instance) clears it; an outcome
 * that observed nothing keeps it, except that a failed observation makes the current app, or the
 * one a failed start launched, unknown rather than stopped. A failed or refused start (an
 * ownership conflict) arrives as the status read that followed it.
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
  const seen = observeApp(generation, request, outcome);
  switch (seen.kind) {
    case "app":
      return shown(seen.app) ?? current;
    case "gone":
      return seen.instanceId === undefined || seen.instanceId === current?.instanceId
        ? undefined
        : current;
    case "nothing":
      return current;
  }
}

/** Logs from a status observation of this generation's app; another owner's logs are not shown. */
export function previewLogs(result: unknown, generation: string) {
  const app = observed(result, generation);
  return {
    instanceId: app?.instanceId ?? null,
    logs: app && isRecord(result) && typeof result.logs === "string" ? result.logs : "",
  };
}
