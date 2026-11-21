import { closeSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { z } from "zod";
import {
  dispatchConfiguration,
  type DispatchConfiguration,
  nodeSocketEnvironment,
} from "../../../server/shared/NodeSocket.ts";
import { sessionLink } from "../../../shared/session/sessionLink.ts";
import {
  readStatus,
  type StartRequest,
  type StatusReply,
  type StatusTarget,
  sendFollowUp,
  startDirectory,
  startSession,
  withLinks,
} from "./SessionDispatch.ts";

const usage = `Usage: node scripts/dispatch-session.ts --json < request.json
       node scripts/dispatch-session.ts <prompt-file> <cwd> [out-file] [options]
       node scripts/dispatch-session.ts follow-up <sessionId> <prompt-file> [--steer] [--ws-url URL] [--origin ORIGIN]
       node scripts/dispatch-session.ts status <sessionId> [--ws-url URL] [--origin ORIGIN]
       node scripts/dispatch-session.ts list --project <projectId> [--ws-url URL] [--origin ORIGIN]

Options:
  --json               Start from one JSON object on stdin; no other arguments allowed.
                        Required: prompt, cwd, outFile, wsUrl, origin (nonblank strings).
                        Optional: worktree { branch }, parentSession, inheritProject.
                        Unknown fields are rejected; prompt is literal data, not shell source.
  --ws-url URL          Override PIANO_SESSION_WS_URL (loopback ws[s]://host:port/ws)
  --origin ORIGIN       Override PIANO_SESSION_ORIGIN (allowed HTTP(S) origin, no trailing /)
  --worktree BRANCH     Create a new worktree on new branch BRANCH from <cwd>'s repository and
                        start the session there; a failure creates no session
  --parent-session ID   Record the dispatching session and inherit its current Piano project
  --no-inherit-project  Start ungrouped, keeping the parent backlink if supplied
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
creation "refused" with submission "not_sent" started nothing (including when Piano could not
be reached); its out-file records that, and may be removed before dispatching again.
Never automatically retry an uncertain dispatch or follow-up; inspect Piano first.`;

class CliError extends Error {
  readonly exitCode: number;
  constructor(exitCode: number, message: string) {
    super(message);
    this.exitCode = exitCode;
  }
}

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
        json: { type: "boolean" },
        "ws-url": { type: "string" },
        origin: { type: "string" },
        worktree: { type: "string" },
        "parent-session": { type: "string" },
        "no-inherit-project": { type: "boolean" },
        steer: { type: "boolean" },
        project: { type: "string" },
      },
    });
  } catch (error) {
    throw new CliError(2, `${(error as Error).message}\n${usage}`);
  }
}

function promptFrom(file: string) {
  try {
    const prompt = readFileSync(file, "utf8");
    if (!prompt.trim()) throw new Error("prompt file must not be empty");
    return prompt;
  } catch (error) {
    throw new CliError(2, (error as Error).message);
  }
}

const nonblank = z.string().refine((value) => value.trim().length > 0, "must not be blank");
const startRequest = z.strictObject({
  prompt: nonblank,
  cwd: nonblank,
  worktree: z
    .strictObject({
      branch: z
        .string()
        .trim()
        .refine((value) => value.length > 0 && !value.startsWith("-"), "must name a new branch"),
    })
    .optional(),
  parentSession: z.string().trim().min(1, "must not be blank").optional(),
  inheritProject: z.boolean().optional(),
});
const jsonRequest = startRequest.extend({
  outFile: nonblank,
  wsUrl: nonblank,
  origin: nonblank,
});

function parsed<T extends z.ZodType>(
  schema: T,
  input: unknown,
  names: Record<string, string> = {},
) {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new CliError(
      2,
      result.error.issues
        .map((issue) => {
          const path = issue.path.join(".");
          return `${names[path] ?? (path || "request")}: ${issue.message}`;
        })
        .join("\n"),
    );
  return result.data as z.output<T>;
}

function requestFromStdin() {
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(0, "utf8"));
  } catch {
    throw new CliError(2, "Invalid JSON on stdin: expected one dispatch request object.");
  }
  return parsed(jsonRequest, input);
}

const flagNames = {
  cwd: "<cwd>",
  "worktree.branch": "--worktree",
  parentSession: "--parent-session",
};

async function main() {
  const { values, positionals } = argumentsFromCommandLine();
  if (values.json) {
    if (positionals.length || Object.keys(values).length !== 1)
      throw new CliError(
        2,
        "--json takes no other arguments; supply all dispatch fields on stdin.",
      );
    const { prompt, cwd, outFile, wsUrl, origin, worktree, parentSession, inheritProject } =
      requestFromStdin();
    const config = dispatchConfiguration({
      PIANO_SESSION_WS_URL: wsUrl,
      PIANO_SESSION_ORIGIN: origin,
    });
    if (!config)
      throw new CliError(
        2,
        "Invalid wsUrl or origin: use a loopback ws[s]://host:port/ws URL and an allowed HTTP(S) origin (no path or trailing slash).",
      );
    await dispatch(
      { prompt, cwd, worktree, dispatchedFrom: parentSession, inheritProject },
      outFile,
      config,
    );
    return;
  }
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
  if (
    ["follow-up", "status", "list"].includes(command ?? "") &&
    (values["parent-session"] !== undefined || values["no-inherit-project"] !== undefined)
  )
    throw new CliError(2, "--parent-session and --no-inherit-project belong to start");
  if (values.steer && command !== "follow-up")
    throw new CliError(2, "--steer belongs to follow-up");
  if (command === "follow-up") {
    if (positionals.length !== 3 || values.project !== undefined) throw new CliError(2, usage);
    const sessionId = positionals[1]!;
    const text = promptFrom(positionals[2]!);
    const { origin } = configured();
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
  const [promptFile, cwd, outFile] = positionals;
  const { parentSession, ...request } = parsed(
    startRequest,
    {
      prompt: promptFrom(promptFile!),
      cwd,
      parentSession: values["parent-session"],
      inheritProject: values["no-inherit-project"] ? false : undefined,
      ...(values.worktree !== undefined ? { worktree: { branch: values.worktree } } : {}),
    },
    flagNames,
  );
  await dispatch({ ...request, dispatchedFrom: parentSession }, outFile, configured());
}

async function dispatch(
  request: StartRequest,
  outFile: string | undefined,
  config: DispatchConfiguration,
) {
  const cwd = startDirectory(request.cwd, process.cwd());
  try {
    if (!statSync(cwd).isDirectory()) throw new Error("cwd must be a directory");
  } catch (error) {
    throw new CliError(2, (error as Error).message);
  }
  let output: number | undefined;
  if (outFile !== undefined) {
    try {
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
    const result = await startSession({ ...request, cwd }, nodeSocketEnvironment(config));
    const link = result.handle ? sessionLink(config.origin, result.handle.sessionId) : null;
    const json = JSON.stringify({ ...result, link }, null, 2);
    if (output !== undefined) writeFileSync(output, `${json}\n`);
    console.log(json);
  } finally {
    if (output !== undefined) closeSync(output);
  }
}

export async function runDispatchCli() {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = error instanceof CliError ? error.exitCode : 1;
  }
}
