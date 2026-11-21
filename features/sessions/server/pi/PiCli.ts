import { fileURLToPath } from "node:url";
import { Context } from "effect";
import type { LaunchEnv } from "../../../../shared/session/dispatch.ts";

export interface PiCliConfig {
  readonly node: string;
  readonly cli: string;
  readonly extraArgs: ReadonlyArray<string>;
  readonly extensions?: ReadonlyArray<string>;
  readonly promptTemplates?: ReadonlyArray<string>;
  readonly skills?: ReadonlyArray<string>;
  readonly env?: Readonly<LaunchEnv>;
}

export const basePiCli = (): PiCliConfig => ({
  node: process.execPath,
  cli: process.env.PIANO_PI_CLI ?? fileURLToPath(new URL("./PiRpcCli.ts", import.meta.url)),
  extraArgs: (process.env.PIANO_PI_ARGS ?? "").split(/\s+/).filter(Boolean),
});

export const PiCli = Context.Reference<PiCliConfig>("piano/PiCli", { defaultValue: basePiCli });
