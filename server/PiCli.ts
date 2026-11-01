/**
 * How to spawn Pi. A Context.Reference so tests can point it at a fake Pi
 * without touching the module that spawns it.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "effect";
import type { LaunchEnv } from "../shared/dispatch.ts";

export interface PiCliConfig {
  /** Node binary used to run the CLI entry. */
  readonly node: string;
  /** Pi CLI entry point, with catalog bootstrap for the locked default. */
  readonly cli: string;
  /** Extra arguments appended to every spawned Pi (PIANO_PI_ARGS). */
  readonly extraArgs: ReadonlyArray<string>;
  /** Absolute `--extension` paths loaded by every spawned Pi, before the session arguments. */
  readonly extensions?: ReadonlyArray<string>;
  /** Absolute `--prompt-template` paths loaded by every spawned Pi: Piano's prompts folder. */
  readonly promptTemplates?: ReadonlyArray<string>;
  /** Launch variables every child gets, such as this instance's session endpoint. */
  readonly env?: Readonly<LaunchEnv>;
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/**
 * Piano's own extensions, resolved from this installation rather than the session's cwd: a
 * session runs in a user's repository, which must not be able to shadow or supply them.
 */
export const pianoSessionExtension = join(ROOT, "extensions/piano-session/index.ts");
export const pianoProjectExtension = join(ROOT, "extensions/piano-project/index.ts");
export const pianoDispatchExtension = join(ROOT, "extensions/piano-dispatch/index.ts");
export const pianoPreviewExtension = join(ROOT, "extensions/piano-preview/index.ts");
export const pianoAskUserExtension = join(ROOT, "extensions/piano-ask-user/index.ts");
export const radiusArtifactsExtension = join(ROOT, "extensions/radius-artifacts/index.ts");

export const defaultPiCli = (): PiCliConfig => ({
  node: process.execPath,
  cli: process.env.PIANO_PI_CLI ?? join(ROOT, "server/PiRpcCli.ts"),
  extraArgs: (process.env.PIANO_PI_ARGS ?? "").split(/\s+/).filter(Boolean),
  extensions: [
    pianoSessionExtension,
    pianoProjectExtension,
    pianoDispatchExtension,
    pianoPreviewExtension,
    pianoAskUserExtension,
    radiusArtifactsExtension,
  ],
});

export const PiCli = Context.Reference<PiCliConfig>("piano/PiCli", { defaultValue: defaultPiCli });
