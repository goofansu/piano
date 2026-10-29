/** Bundled Pi extension: dispatch work through Piano, never launch or own another Pi process. */
import { type JsonValue, type Static, type TSchema, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DISPATCH_ENTRY,
  DISPATCHED_FROM_FLAG,
  DISPOSITIONS,
  type SessionHandle,
  type SessionStatus,
  START_TOOL,
  STATUS_TOOL,
  type StartArguments,
  type StartToolResult,
  type StatusArguments,
  WAIT_STATUSES,
  WAIT_TOOL,
  type WaitArguments,
  type WaitToolResult,
} from "../../shared/dispatch.ts";
import { dispatchConfiguration, nodeSocketEnvironment } from "./NodeSocket.ts";
import { readStatus, startSession, waitSessions, withLinks } from "./SessionDispatch.ts";

/** The schema one of these literals has. */
type LiteralSchema<Value> = Value extends string ? ReturnType<typeof Type.Literal<Value>> : never;
/** A union of the given literals. Mapping the values in place would type it as a union of none. */
const literals = <const Values extends ReadonlyArray<string>>(
  values: Values,
  options?: { description: string },
) =>
  Type.Union(
    values.map((value) => Type.Literal(value)) as unknown as [LiteralSchema<Values[number]>],
    options,
  );

const Handle = Type.Object({
  cwd: Type.String(),
  sessionId: Type.String(),
  generation: Type.String(),
  submissionId: Type.Union([Type.Integer(), Type.Null()]),
  baselineMessages: Type.Integer({ minimum: 0 }),
  baselineFingerprint: Type.String(),
  inputFingerprint: Type.String(),
  anchorMessageId: Type.Union([Type.String(), Type.Null()]),
});
const NullableString = Type.Union([Type.String(), Type.Null()]);
const Observation = Type.Object({
  handle: Handle,
  status: literals(WAIT_STATUSES),
  ending: Type.Union([Type.Literal("observed"), Type.Literal("deadline"), Type.Literal("aborted")]),
  answer: NullableString,
  attribution: Type.Union([
    Type.Literal("attributed"),
    Type.Literal("no-output"),
    Type.Literal("unattributable"),
  ]),
  detail: Type.Optional(Type.String()),
  link: Type.String(),
});
const Worktree = Type.Object({
  branch: Type.String({ minLength: 1, description: "New branch name; it must not exist yet" }),
  hooks: Type.Optional(
    Type.Boolean({ description: "Run approved Worktrunk hooks; unapproved hooks refuse creation" }),
  ),
});
const StartParameters = Type.Object({
  prompt: Type.String({ minLength: 1, description: "Self-contained work brief" }),
  cwd: Type.Optional(Type.String({ minLength: 1 })),
  worktree: Type.Optional(Worktree),
});
const StartOutput = Type.Object({
  cwd: Type.String(),
  creation: Type.Union([
    Type.Literal("created"),
    Type.Literal("refused"),
    Type.Literal("uncertain"),
  ]),
  submission: Type.String(),
  handle: Type.Union([Handle, Type.Null()]),
  worktree: Type.Union([Type.Object({ path: Type.String(), branch: Type.String() }), Type.Null()]),
  detail: Type.Optional(Type.String()),
  link: NullableString,
});
const WaitParameters = Type.Object({
  sessions: Type.Array(Handle, { minItems: 1, maxItems: 32 }),
  timeoutMs: Type.Optional(
    Type.Integer({
      minimum: 1000,
      maximum: 60000,
      description: "Only for an explicitly bounded observation; omit to wait for completion.",
    }),
  ),
});
const WaitOutput = Type.Object({ results: Type.Array(Observation) });
const StatusParameters = Type.Object({
  sessionId: Type.String({
    minLength: 1,
    description: "A session ID, as a start or link names it",
  }),
});
const StatusOutput = Type.Object({
  sessionId: Type.String(),
  cwd: Type.String(),
  projectId: NullableString,
  disposition: literals(DISPOSITIONS),
  since: NullableString,
  needs: Type.Union([
    Type.Object({ title: Type.String(), kind: Type.String(), link: Type.String() }),
    Type.Null(),
  ]),
  lastAnswer: NullableString,
  changes: Type.Union([
    Type.Object({
      branch: NullableString,
      files: Type.Number(),
      pullRequest: Type.Union([
        Type.Object({ number: Type.Number(), url: Type.String(), state: NullableString }),
        Type.Null(),
      ]),
    }),
    Type.Null(),
  ]),
  link: Type.String(),
});

/**
 * The schemas describe shared/dispatch.ts's shapes to Pi; these fail the type check when they
 * drift apart. A schema may be looser than its shape (the start output's submission is any
 * string), but every value of the shape must fit it and both must name the same fields.
 */
type Describes<Schema extends TSchema, Shape> = [Shape] extends [Static<Schema>]
  ? [keyof Shape] extends [keyof Static<Schema>]
    ? [keyof Static<Schema>] extends [keyof Shape]
      ? true
      : false
    : false
  : false;
type Exact<Schema extends TSchema, Shape> = [Static<Schema>] extends [Shape]
  ? Describes<Schema, Shape>
  : false;
type Holds<T extends true> = T;
export type SchemaChecks = [
  Holds<Exact<typeof Handle, SessionHandle>>,
  Holds<Exact<typeof Observation, WaitToolResult["results"][number]>>,
  Holds<Exact<typeof StartParameters, StartArguments>>,
  Holds<Describes<typeof StartOutput, StartToolResult>>,
  Holds<Exact<typeof WaitParameters, WaitArguments>>,
  Holds<Exact<typeof WaitOutput, WaitToolResult>>,
  Holds<Exact<typeof StatusParameters, StatusArguments>>,
  Holds<Describes<typeof StatusOutput, SessionStatus>>,
];

export default function pianoDispatch(pi: ExtensionAPI) {
  // Registered before the configuration check, so Pi always knows the flag Piano may pass.
  pi.registerFlag(DISPATCHED_FROM_FLAG, {
    type: "string",
    description: "Session that dispatched this one (set by Piano)",
  });
  pi.on("session_start", (_event, ctx) => {
    const parent = pi.getFlag(DISPATCHED_FROM_FLAG);
    // Recorded once, before the brief; a relaunch with the flag finds it already there.
    if (
      typeof parent === "string" &&
      parent &&
      !ctx.sessionManager
        .getEntries()
        .some((entry) => entry.type === "custom" && entry.customType === DISPATCH_ENTRY)
    )
      pi.appendEntry(DISPATCH_ENTRY, { parentSessionId: parent });
  });
  const config = dispatchConfiguration();
  // No sockets at factory time: Pi also loads extensions for catalog probes and discovery.
  if (!config) return;
  const environment = nodeSocketEnvironment(config);
  const active = new Set<AbortController>();
  const link = (sessionId: string) =>
    new URL(`/s/${encodeURIComponent(sessionId)}`, config.origin).href;
  const invoke = async <T>(
    signal: AbortSignal | undefined,
    run: (signal: AbortSignal) => Promise<T>,
  ) => {
    const controller = new AbortController();
    active.add(controller);
    try {
      const result = await run(
        signal ? AbortSignal.any([signal, controller.signal]) : controller.signal,
      );
      // The model and codemode callers must receive the same reference and outcome as details.
      const text = JSON.stringify(result);
      return {
        content: [{ type: "text" as const, text }],
        details: result,
        structuredContent: JSON.parse(text) as JsonValue,
      };
    } finally {
      active.delete(controller);
    }
  };
  pi.on("session_shutdown", () => {
    for (const controller of active) controller.abort();
    active.clear();
  });

  pi.registerTool(
    defineTool({
      name: START_TOOL,
      label: "Start Piano session",
      promptSnippet: "Start a Piano session, optionally in a new worktree",
      promptGuidelines: [
        "piano_session_status only reads: use it whenever you need to know what a Piano session is doing, dispatched or not.",
      ],
      description:
        "Dispatch work to a fresh, visible Piano session. Supply a non-empty, self-contained brief: objective, relevant decisions/files, constraints, expected output and necessary checks. The new conversation does not inherit this transcript. cwd defaults to this checkout. worktree: { branch } makes Piano create a new worktree on that new branch from cwd's repository and start the session there. A missing cwd, a non-Git cwd or a branch that exists refuses the start and creates no session. Worktrunk hooks are skipped unless worktree.hooks is true; then an unapproved hook refuses the start, and a failed hook may leave the new checkout on disk (see detail). Always uses normal new-session model and effort defaults, not the parent's settings. Returns creation (created; refused, when no session exists; or uncertain, when one may), submission (what Pi did with the brief: started, queued, handled, needs_input, rejected, not_sent or uncertain), a handle to pass unchanged to piano_wait_sessions, the created worktree, and an Open session link. Creation/admission is not completion. On uncertain creation or delivery inspect Piano before trying again: never automatically repeat dispatch.",
      parameters: StartParameters,
      outputSchema: StartOutput,
      async execute(_id, params, signal, _update, ctx) {
        if (!params.prompt.trim())
          throw new Error("A non-empty, self-contained work brief is required.");
        return invoke(signal, async (observationSignal) => {
          const result = await startSession(
            {
              prompt: params.prompt,
              cwd: params.cwd ?? ctx.cwd,
              worktree: params.worktree,
              dispatchedFrom: ctx.sessionManager.getSessionId(),
            },
            environment,
            observationSignal,
          );
          const output: StartToolResult = {
            ...result,
            link: result.handle ? link(result.handle.sessionId) : null,
          };
          return output;
        });
      },
    }),
  );
  pi.registerTool(
    defineTool({
      name: STATUS_TOOL,
      label: "Piano session status",
      promptSnippet: "Read a Piano session's status by its ID",
      description:
        "Read what a Piano session is doing and what it needs, by session ID, without waiting or opening it. Works for any session Piano lists, after a lost reply or a Piano restart. Returns disposition (running, needs_input, settled, exited or unknown) with since, what a needs_input session asks for, the last turn's final answer (bounded) or null, changes (branch, changed file count, linked pull request) and the session link. settled means execution stopped, not that the task succeeded; unknown means live facts are gone and history proves no ending. One read: call again to observe later.",
      parameters: StatusParameters,
      outputSchema: StatusOutput,
      async execute(_id, params, signal) {
        return invoke(signal, async (readSignal) => {
          const reply = await readStatus({ sessionId: params.sessionId }, environment, readSignal);
          if (reply.status === "error") throw new Error(reply.detail);
          const [facts] = reply.sessions;
          if (!facts) throw new Error(`Piano lists no session ${params.sessionId}.`);
          const output: SessionStatus = withLinks(facts, link);
          return output;
        });
      },
    }),
  );
  pi.registerTool(
    defineTool({
      name: WAIT_TOOL,
      label: "Wait for Piano sessions",
      promptSnippet: "Wait for dispatched Piano work",
      description:
        "Wait for fresh work sessions using the exact handles returned by piano_start_session. Omit timeoutMs: one call stays open until all sessions finish or any needs input, fails, is cancelled or becomes unobservable. Do not poll with repeated short waits or status reads when you need completion. Only set timeoutMs (1000–60000) for an explicitly bounded observation. Returns every handle's current result with running, settled, failed, cancelled, needs_input or unknown status, answer or null, and Open session links. ending=deadline is an observation limit, not child failure. Cancelling this wait only closes observation; children keep running. Lost connections and unreadable state have bounded recovery. Later input, a restarted host or missing evidence may prevent attribution; inspect that session instead. Settlement does not certify task/check success, handled input may have no answer, and child completion does not wake a parent whose turn has ended. When called through codemode, await the call and omit the script timeout too.",
      parameters: WaitParameters,
      outputSchema: WaitOutput,
      async execute(_id, params, signal) {
        return invoke(signal, async (observationSignal) => {
          const results = await waitSessions(
            params.sessions,
            params.timeoutMs,
            environment,
            observationSignal,
          );
          const output: WaitToolResult = {
            results: results.map((result) => ({ ...result, link: link(result.handle.sessionId) })),
          };
          return output;
        });
      },
    }),
  );
}
