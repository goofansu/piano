#!/usr/bin/env node
/** Start a Piano session from a terminal, over the same dispatch modules the Pi extension uses.
 * Piano places the directory: a linked worktree is listed under its main checkout's folder. */
import { closeSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  dispatchConfiguration,
  nodeSocketEnvironment,
} from "../extensions/piano-sessions/NodeSocket.ts";
import { startSession } from "../extensions/piano-sessions/SessionDispatch.ts";
import { ThinkingLevel } from "../shared/wire.ts";

const levels = ThinkingLevel.literals.join(", ");
const usage = `Usage: node scripts/dispatch-session.ts <prompt-file> <cwd> [out-file] [options]

Options:
  --ws-url URL          Override PIANO_SESSION_WS_URL (loopback ws[s]://host:port/ws)
  --origin ORIGIN       Override PIANO_SESSION_ORIGIN (allowed HTTP(S) origin, no trailing /)
  --model provider/id   New session model; omitted uses Piano's default
  --thinkingLevel LEVEL  ${levels}; omitted uses Piano's default
  --help               Show this help

Prints start JSON to stdout, and optionally saves it exclusively to out-file.
Exit codes: 0 result reported (inspect creation/submission), 1 unexpected failure,
2 invalid input/configuration, 3 output already exists.
Never automatically retry an uncertain dispatch; inspect Piano first.`;

class CliError extends Error {
  readonly exitCode: number;
  constructor(exitCode: number, message: string) {
    super(message);
    this.exitCode = exitCode;
  }
}

function argumentsFromCommandLine() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        help: { type: "boolean" },
        "ws-url": { type: "string" },
        origin: { type: "string" },
        model: { type: "string" },
        thinkingLevel: { type: "string" },
      },
    });
  } catch (error) {
    throw new CliError(2, `${(error as Error).message}\n${usage}`);
  }
}

const isThinkingLevel = (value: string): value is ThinkingLevel =>
  (ThinkingLevel.literals as readonly string[]).includes(value);

async function main() {
  const { values, positionals } = argumentsFromCommandLine();
  if (values.help) {
    console.log(usage);
    return;
  }
  if (positionals.length < 2 || positionals.length > 3) throw new CliError(2, usage);
  const model = values.model;
  if (model !== undefined && !/^[^/\s]+\/\S+$/.test(model))
    throw new CliError(2, "--model must be provider/id");
  const thinkingLevel = values.thinkingLevel;
  if (thinkingLevel !== undefined && !isThinkingLevel(thinkingLevel))
    throw new CliError(2, `Invalid --thinkingLevel; choose ${levels}`);
  const config = dispatchConfiguration({
    ...process.env,
    PIANO_SESSION_WS_URL: values["ws-url"] ?? process.env.PIANO_SESSION_WS_URL,
    PIANO_SESSION_ORIGIN: values.origin ?? process.env.PIANO_SESSION_ORIGIN,
  });
  if (!config)
    throw new CliError(
      2,
      "Set --ws-url / PIANO_SESSION_WS_URL to a loopback ws[s]://host:port/ws URL and --origin / PIANO_SESSION_ORIGIN to an allowed HTTP(S) origin (no path or trailing slash).",
    );
  const [promptFile, rawCwd, outFile] = positionals;
  const cwd = resolve(rawCwd);
  let prompt: string;
  try {
    if (!statSync(cwd).isDirectory()) throw new Error("cwd must be a directory");
    prompt = readFileSync(promptFile, "utf8");
    if (!prompt.trim()) throw new Error("prompt file must not be empty");
  } catch (error) {
    throw new CliError(2, (error as Error).message);
  }
  let output: number | undefined;
  if (outFile !== undefined) {
    try {
      // Reserve before any network side effect, including concurrent invocations.
      output = openSync(outFile, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST")
        throw new CliError(
          3,
          `Refusing: ${outFile} exists; inspect it and Piano before dispatching again`,
        );
      throw new CliError(2, `Cannot open output file: ${(error as Error).message}`);
    }
  }
  try {
    const result = await startSession(
      { prompt, cwd, model, thinkingLevel },
      nodeSocketEnvironment(config),
    );
    const link = result.handle
      ? new URL(`/s/${encodeURIComponent(result.handle.sessionId)}`, config.origin).href
      : null;
    const json = JSON.stringify(
      { ...result, link, model: model ?? null, thinkingLevel: thinkingLevel ?? null },
      null,
      2,
    );
    if (output !== undefined) writeFileSync(output, `${json}\n`);
    console.log(json);
  } finally {
    // Once creation was attempted, even an empty file is a guard against blind retry.
    if (output !== undefined) closeSync(output);
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = error instanceof CliError ? error.exitCode : 1;
}
