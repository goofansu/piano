import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "effect";
import type { LaunchEnv } from "../../../../shared/features/dispatch/dispatch.ts";

export interface PiCliConfig {
  readonly node: string;
  readonly cli: string;
  readonly extraArgs: ReadonlyArray<string>;
  readonly extensions?: ReadonlyArray<string>;
  readonly promptTemplates?: ReadonlyArray<string>;
  readonly skills?: ReadonlyArray<string>;
  readonly env?: Readonly<LaunchEnv>;
}

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));

export const pianoSessionExtension = join(ROOT, "extensions/piano-session/index.ts");
export const pianoProjectExtension = join(ROOT, "extensions/piano-project/index.ts");
export const pianoDispatchExtension = join(ROOT, "extensions/piano-dispatch/index.ts");
export const pianoAskUserExtension = join(ROOT, "extensions/piano-ask-user/index.ts");
export const pianoLibraryExtension = join(ROOT, "extensions/piano-library/index.ts");
export const radiusArtifactsExtension = join(ROOT, "extensions/radius-artifacts/index.ts");

export const defaultPiCli = (): PiCliConfig => ({
  node: process.execPath,
  cli: process.env.PIANO_PI_CLI ?? join(ROOT, "server/PiRpcCli.ts"),
  extraArgs: (process.env.PIANO_PI_ARGS ?? "").split(/\s+/).filter(Boolean),
  extensions: [
    pianoSessionExtension,
    pianoProjectExtension,
    pianoDispatchExtension,
    pianoAskUserExtension,
    pianoLibraryExtension,
    radiusArtifactsExtension,
  ],
});

export const PiCli = Context.Reference<PiCliConfig>("piano/PiCli", { defaultValue: defaultPiCli });
