#!/usr/bin/env node
/** Start a Piano session, send a running one a follow-up, or read sessions' status, from a
 * terminal, over the same dispatch modules the Pi extension uses. Piano places the directory: a linked worktree is listed under its main
 * checkout's folder, and `--worktree` has Piano create a new one first. */
import { closeSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  dispatchConfiguration,
  nodeSocketEnvironment,
} from "../extensions/piano-dispatch/NodeSocket.ts";
import {
  readStatus,
  type StatusReply,
  type StatusTarget,
  sendFollowUp,
  startSession,
  withLinks,
} from "../extensions/piano-dispatch/SessionDispatch.ts";
import { ThinkingLevel } from "../shared/wire.ts";

const levels = ThinkingLevel.literals.join(", ");
const usage = `Usage: node scripts/dispatch-session.ts <prompt-file> <cwd> [out-file] [options]
       node scripts/dispatch-session.ts follow-up <sessionId> <prompt-file> [--steer] [--ws-url URL] [--origin ORIGIN]
       node scripts/dispatch-session.ts status <sessionId> [--ws-url URL] [--origin ORIGIN]
       node scripts/dispatch-session.ts list --project <projectId> [--ws-url URL] [--origin ORIGIN]

Options:
  --ws-url URL          Override PIANO_SESSION_WS_URL (loopback ws[s]://host:port/ws)
  --origin ORIGIN       Override PIANO_SESSION_ORIGIN (allowed HTTP(S) origin, no trailing /)
  --worktree BRANCH     Create a new worktree on new branch BRANCH from <cwd>'s repository and
                        start the session there; a failure creates no session
  --hooks               With --worktree, run approved Worktrunk hooks (default: off)
  --model provider/id   New session model; omitted uses Piano's default
  --thinkingLevel LEVEL  ${levels}; omitted uses Piano's default
  --steer               With follow-up, steer the current run at Pi's next tool boundary instead
                        of waiting for it to finish
  --project ID          With list, the project whose active sessions to read
  --help               Show this help

A start prints its JSON to stdout, and optionally saves it exclusively to out-file.
follow-up prints Pi's handling of the message (submission) and the session link.
status prints one session's status JSON; list prints one status JSON object per line.
Exit codes: 0 result reported (inspect creation/submission), 1 unexpected failure,
2 invalid input/configuration (including a session or project Piano does not list),
3 output already exists.
Never automatically retry an uncertain dispatch or follow-up; inspect Piano first.`;

class CliError extends Error {
  readonly exitCode: number;
  constructor(exitCode: number, message: string) {
    super(message);
    this.exitCode = exitCode;
  }
}

/** A status read's sessions; a session or project Piano does not list is invalid input (2). */
function sessionsOf(reply: StatusReply) {
  if (reply.status === "ready") return reply.sessions;
  throw new CliError(reply.status === "unlisted" ? 2 : 1, reply.detail);
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
        worktree: { type: "string" },
        hooks: { type: "boolean" },
        steer: { type: "boolean" },
        project: { type: "string" },
      },
    });
  } catch (error) {
    throw new CliError(2, `${(error as Error).message}\n${usage}`);
  }
}

const sessionLink = (origin: string, sessionId: string) =>
  new URL(`/s/${encodeURIComponent(sessionId)}`, origin).href;

/** The prompt file's text; an unreadable or blank file is invalid input. */
function promptFrom(file: string) {
  try {
    const prompt = readFileSync(file, "utf8");
    if (!prompt.trim()) throw new Error("prompt file must not be empty");
    return prompt;
  } catch (error) {
    throw new CliError(2, (error as Error).message);
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
  const config = dispatchConfiguration({
    ...process.env,
    PIANO_SESSION_WS_URL: values["ws-url"] ?? process.env.PIANO_SESSION_WS_URL,
    PIANO_SESSION_ORIGIN: values.origin ?? process.env.PIANO_SESSION_ORIGIN,
  });
  const configured = () => {
    if (!config)
      throw new CliError(
        2,
        "Set --ws-url / PIANO_SESSION_WS_URL to a loopback ws[s]://host:port/ws URL and --origin / PIANO_SESSION_ORIGIN to an allowed HTTP(S) origin (no path or trailing slash).",
      );
    return config;
  };
  const command = positionals[0];
  if (values.steer && command !== "follow-up")
    throw new CliError(2, "--steer belongs to follow-up");
  if (command === "follow-up") {
    if (positionals.length !== 3 || values.project !== undefined) throw new CliError(2, usage);
    const sessionId = positionals[1]!;
    const text = promptFrom(positionals[2]!);
    const { origin } = configured();
    // The status read names the session's directory, and refuses a session Piano does not list.
    const [session] = sessionsOf(
      await readStatus({ sessionId }, nodeSocketEnvironment(configured())),
    );
    const result = await sendFollowUp(
      {
        cwd: session!.cwd,
        sessionId,
        text,
        delivery: values.steer ? "steer" : "follow-up",
      },
      nodeSocketEnvironment(configured()),
    );
    console.log(JSON.stringify({ ...result, link: sessionLink(origin, sessionId) }, null, 2));
    return;
  }
  if (command === "status" || command === "list") {
    let target: StatusTarget;
    if (command === "status") {
      if (positionals.length !== 2 || values.project !== undefined) throw new CliError(2, usage);
      target = { sessionId: positionals[1]! };
    } else {
      if (positionals.length !== 1 || !values.project) throw new CliError(2, usage);
      target = { projectId: values.project };
    }
    const { origin } = configured();
    const sessions = sessionsOf(await readStatus(target, nodeSocketEnvironment(configured())));
    const statuses = sessions.map((facts) => withLinks(facts, (id) => sessionLink(origin, id)));
    if (command === "status") console.log(JSON.stringify(statuses[0], null, 2));
    else for (const status of statuses) console.log(JSON.stringify(status));
    return;
  }
  if (positionals.length < 2 || positionals.length > 3) throw new CliError(2, usage);
  if (values.project !== undefined) throw new CliError(2, "--project belongs to list");
  if (values.hooks && values.worktree === undefined)
    throw new CliError(2, "--hooks needs --worktree");
  const worktree = values.worktree?.trim();
  if (worktree !== undefined && (!worktree || worktree.startsWith("-")))
    throw new CliError(2, "--worktree must name a new branch");
  const model = values.model;
  if (model !== undefined && !/^[^/\s]+\/\S+$/.test(model))
    throw new CliError(2, "--model must be provider/id");
  const thinkingLevel = values.thinkingLevel;
  if (thinkingLevel !== undefined && !isThinkingLevel(thinkingLevel))
    throw new CliError(2, `Invalid --thinkingLevel; choose ${levels}`);
  const { origin } = configured();
  const [promptFile, rawCwd, outFile] = positionals;
  const cwd = resolve(rawCwd);
  try {
    if (!statSync(cwd).isDirectory()) throw new Error("cwd must be a directory");
  } catch (error) {
    throw new CliError(2, (error as Error).message);
  }
  const prompt = promptFrom(promptFile);
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
      {
        prompt,
        cwd,
        model,
        thinkingLevel,
        ...(worktree ? { worktree: { branch: worktree, hooks: values.hooks } } : {}),
      },
      nodeSocketEnvironment(configured()),
    );
    const link = result.handle ? sessionLink(origin, result.handle.sessionId) : null;
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
