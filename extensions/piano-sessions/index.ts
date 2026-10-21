/** Bundled Pi tools: dispatch through Piano, never launch or own another Pi process. */
import { type JsonValue, type Static, type TSchema, Type } from "@earendil-works/pi-ai";
import {
  defineTool,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
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
import { ThinkingLevel } from "../../shared/wire.ts";
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
  model: Type.Optional(Type.String({ minLength: 1 })),
  thinkingLevel: Type.Optional(
    literals(ThinkingLevel.literals, {
      description: "Reasoning effort; choose a level supported by the selected model.",
    }),
  ),
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
  timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 60000 })),
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

export default function pianoSessions(pi: ExtensionAPI) {
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
  // Piano owns this child under one session ID (INV-02, INV-07). An extension's newSession,
  // switchSession or fork would replace it behind that ID, so Pi is told to cancel; Piano starts,
  // opens and dispatches sessions itself. Any handler's cancel wins, whatever the load order.
  const refuseReplacement = (_event: unknown, ctx: ExtensionContext) => {
    ctx.ui.notify(
      "Piano keeps this session open. Start or open another session from Piano.",
      "error",
    );
    return { cancel: true };
  };
  pi.on("session_before_switch", refuseReplacement);
  pi.on("session_before_fork", refuseReplacement);
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
      promptSnippet: "Dispatch work to a new Piano session when explicitly requested",
      promptGuidelines: [
        "Use Piano session tools only when the user explicitly asks to dispatch work through Piano. Otherwise, work in the current session. Waiting for that dispatched work is part of the authorized request.",
      ],
      description:
        "Dispatch work to a fresh, visible Piano session. Supply a non-empty, self-contained brief: objective, relevant decisions/files, constraints, expected output and necessary checks. The new conversation does not inherit this transcript. cwd defaults to this checkout. worktree: { branch } makes Piano create a new worktree on that new branch from cwd's repository and start the session there; use it for each concurrent writing task. A branch that exists, a hook that needs approval or a non-Git cwd refuses the start and creates no session. model is an optional provider/model; thinkingLevel optionally sets reasoning effort supported by that model. Omitted options use normal new-session defaults, not the parent's settings. Returns the initial prompt's disposition, a handle to pass unchanged to piano_wait_sessions, and an Open session link. Creation/admission is not completion. On uncertain delivery inspect Piano before trying again: never automatically repeat dispatch.",
      parameters: StartParameters,
      outputSchema: StartOutput,
      async execute(_id, params, signal, _update, ctx) {
        if (!params.prompt.trim())
          throw new Error("A non-empty, self-contained work brief is required.");
        return invoke(signal, async (observationSignal) => {
          const result = await startSession(
            {
              ...params,
              cwd: params.cwd ?? ctx.cwd,
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
        "Read what a Piano session is doing and what it needs, by session ID, without waiting or opening it. Works for any session Piano lists, after a lost reply or a Piano restart. Returns disposition (running, needs_input, settled, exited or unknown) with since, what a needs_input session asks for, the last turn's final answer (bounded) or null, changes (branch, changed files, linked pull request) and the session link. settled means execution stopped, not that the task succeeded; unknown means live facts are gone and history proves no ending. One read: call again to observe later.",
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
      promptSnippet: "Wait for explicitly dispatched Piano work",
      description:
        "Observe fresh work sessions using the exact handles returned by piano_start_session. Default wait 30 seconds; timeoutMs allows 1000–60000. Returns partial results with running, settled, failed, cancelled, waiting_for_input or unknown status, answer or null, and Open session links. ending=deadline is an observation limit, not child failure. Cancelling this wait never stops children. Later input, a restarted host or missing evidence may prevent attribution; inspect that session instead. Settlement does not certify task/check success, handled input may have no answer, and child completion does not automatically wake this parent.",
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
