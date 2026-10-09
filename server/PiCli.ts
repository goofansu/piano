/**
 * How to spawn Pi. A Context.Reference so tests can point it at a fake Pi
 * without touching the module that spawns it.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "effect";

export interface PiCliConfig {
  /** Node binary used to run the CLI entry. */
  readonly node: string;
  /** Pi CLI entry point, with catalog bootstrap for the locked default. */
  readonly cli: string;
  /** Extra arguments appended to every spawned Pi (PIANO_PI_ARGS). */
  readonly extraArgs: ReadonlyArray<string>;
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));

export const defaultPiCli = (): PiCliConfig => ({
  node: process.execPath,
  cli: process.env.PIANO_PI_CLI ?? join(ROOT, "server/PiRpcCli.ts"),
  extraArgs: (process.env.PIANO_PI_ARGS ?? "").split(/\s+/).filter(Boolean),
});

export const PiCli = Context.Reference<PiCliConfig>("piano/PiCli", { defaultValue: defaultPiCli });
