import { readFile } from "node:fs/promises";
import { constants } from "node:os";

/** The first terminal cause, before supervisor cleanup can replace it with a group signal. */
export interface PreviewOutcome {
  instanceId: string;
  generation: string;
  reason: "app-exit" | "spawn-error" | "stop" | "owner-disconnect";
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}

export const outcomePath = (intentPath: string, instanceId: string) =>
  `${intentPath}.${instanceId}.outcome`;

export async function readOutcome(
  path: string,
  instanceId: string,
  generation: string,
): Promise<PreviewOutcome | undefined> {
  let value: PreviewOutcome;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (
    !value ||
    value.instanceId !== instanceId ||
    value.generation !== generation ||
    !["app-exit", "spawn-error", "stop", "owner-disconnect"].includes(value.reason) ||
    !(value.exitCode === null || (Number.isInteger(value.exitCode) && value.exitCode >= 0)) ||
    !(value.signal === null || typeof value.signal === "string")
  )
    throw new Error(
      "Preview terminal outcome is invalid; refusing to attribute it to this launch.",
    );
  return value;
}

/**
 * The runner's exit status for an outcome. On Linux systemd reports a non-zero status as `failed`,
 * so this one rule decides failure there and, through `outcomeFailed`, everywhere else.
 */
export const outcomeStatus = ({
  reason,
  exitCode,
  signal,
}: Pick<PreviewOutcome, "reason" | "exitCode" | "signal">) => {
  if (reason === "spawn-error") return 1;
  if (reason !== "app-exit") return 0;
  if (exitCode !== null) return exitCode;
  return signal ? 128 + constants.signals[signal] : 1;
};

export const outcomeFailed = (outcome: PreviewOutcome) => outcomeStatus(outcome) !== 0;
