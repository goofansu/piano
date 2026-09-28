/**
 * How to spawn pi. A Context.Reference so tests can point it at a fake pi
 * without touching the module that spawns it.
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Context } from "effect";

export interface PiCliConfig {
  /** Node binary used to run the CLI entry. */
  readonly node: string;
  /** pi CLI entry point (dist/cli.js). */
  readonly cli: string;
  /** Extra arguments appended to every spawned pi (PIANO_PI_ARGS). */
  readonly extraArgs: ReadonlyArray<string>;
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));

export const defaultPiCli = (): PiCliConfig => ({
  node: process.execPath,
  cli: process.env.PIANO_PI_CLI ?? join(ROOT, "node_modules/@earendil-works/pi-coding-agent/dist/cli.js"),
  extraArgs: (process.env.PIANO_PI_ARGS ?? "").split(/\s+/).filter(Boolean),
});

export const PiCli = Context.Reference<PiCliConfig>("piano/PiCli", { defaultValue: defaultPiCli });
