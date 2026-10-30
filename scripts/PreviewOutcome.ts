import { readFile } from "node:fs/promises";

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

export const outcomeFailed = (outcome: PreviewOutcome) =>
  outcome.reason === "spawn-error" ||
  (outcome.reason === "app-exit" && (outcome.exitCode !== 0 || outcome.signal !== null));
