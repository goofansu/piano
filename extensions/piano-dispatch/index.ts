/** Bundled Pi extension: dispatch work through Piano, never launch or own another Pi process. */
import { isAbsolute, resolve } from "node:path";
import { type JsonValue, StringEnum } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  arr,
  bool,
  int,
  nullable,
  num,
  obj,
  opt,
  type Schema,
  type Static,
  str,
} from "@earendil-works/pi-schema";
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
import { sessionLink } from "../../shared/sessionLink.ts";
import { dispatchConfiguration, nodeSocketEnvironment } from "./NodeSocket.ts";
import { readStatus, startSession, waitSessions, withLinks } from "./SessionDispatch.ts";

/**
 * The directory a start names, read from the parent session's checkout: Piano's server runs
 * elsewhere, so a relative path it resolved would land in the server's own checkout. Absolute and
 * home-relative paths pass through unchanged for Piano to spell.
 */
const dispatchDirectory = (requested: string | undefined, parent: string): string =>
  requested === undefined || isAbsolute(requested) || /^~(?=$|\/)/.test(requested)
    ? (requested ?? parent)
    : resolve(parent, requested);

const Handle = obj({
  cwd: str(),
  sessionId: str(),
  generation: str(),
  submissionId: nullable(int()),
  baselineMessages: int({ minimum: 0 }),
  baselineFingerprint: str(),
  inputFingerprint: str(),
  anchorMessageId: nullable(str()),
});
const NullableString = nullable(str());
const Observation = obj({
  handle: Handle,
  status: StringEnum(WAIT_STATUSES),
  ending: StringEnum(["observed", "deadline", "aborted"] as const),
  answer: NullableString,
  attribution: StringEnum(["attributed", "no-output", "unattributable"] as const),
  detail: opt(str()),
  link: str(),
});
const Worktree = obj({
  branch: str({ minLength: 1, description: "New branch name; it must not exist yet" }),
  hooks: opt(
    bool({ description: "Run approved Worktrunk hooks; unapproved hooks refuse creation" }),
  ),
});
const StartParameters = obj({
  prompt: str({ minLength: 1, description: "Self-contained work brief" }),
  cwd: opt(str({ minLength: 1 })),
  worktree: opt(Worktree),
  inheritProject: opt(
    bool({
      description:
        "Inherit the parent’s current Piano project (named session group), independent of cwd/worktree. Defaults to true; false starts ungrouped.",
    }),
  ),
});
const StartOutput = obj({
  cwd: str(),
  creation: StringEnum(["created", "refused", "uncertain"] as const),
  submission: str(),
  handle: nullable(Handle),
  worktree: nullable(obj({ path: str(), branch: str() })),
  detail: opt(str()),
  link: NullableString,
});
const WaitParameters = obj({
  sessions: arr(Handle, { minItems: 1, maxItems: 32 }),
  timeoutMs: opt(
    int({
      minimum: 1000,
      maximum: 60000,
      description: "Only for an explicitly bounded observation; omit to wait for completion.",
    }),
  ),
});
const WaitOutput = obj({ results: arr(Observation) });
const StatusParameters = obj({
  sessionId: str({ minLength: 1, description: "A session ID, as a start or link names it" }),
});
const StatusOutput = obj({
  sessionId: str(),
  cwd: str(),
  projectId: NullableString,
  disposition: StringEnum(DISPOSITIONS),
  since: NullableString,
  needs: nullable(obj({ title: str(), kind: str(), link: str() })),
  lastAnswer: NullableString,
  changes: nullable(
    obj({
      branch: NullableString,
      files: num(),
      pullRequest: nullable(obj({ number: num(), url: str(), state: NullableString })),
    }),
  ),
  link: str(),
});

/**
 * The schemas describe shared/dispatch.ts's shapes to Pi; these fail the type check when they
 * drift apart. A schema may be looser than its shape (the start output's submission is any
 * string), but every value of the shape must fit it and both must name the same fields.
 */
type Describes<S extends Schema, Shape> = [Shape] extends [Static<S>]
  ? [keyof Shape] extends [keyof Static<S>]
    ? [keyof Static<S>] extends [keyof Shape]
      ? true
      : false
    : false
  : false;
type Exact<S extends Schema, Shape> = [Static<S>] extends [Shape] ? Describes<S, Shape> : false;
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

const INPUT_GUIDELINE =
  "If piano_start_session, piano_session_status or piano_wait_sessions reports needs_input, link to that session so the user answers there rather than repeating its question here.";

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
  const link = (sessionId: string) => sessionLink(config.origin, sessionId);
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
        "Complete the task in the current session by default. Use piano_start_session for bounded work when it enables useful parallelism, required workspace isolation, or a handoff called for by user or project instructions. Before dispatching, identify the benefit and the child's completion check. Reuse supplied findings; inspect missing context here until you can scope the work.",
        "Delegating execution through piano_start_session preserves the parent's responsibility for the requested outcome. Transfer delivery and follow-up only when user or project instructions call for a handoff; a new session or worktree does not itself transfer ownership.",
        "In the piano_start_session brief, state what the child owns and what remains in the parent, including delivery and follow-up. A dispatched child carries out its assigned task; further dispatch is for distinct subtasks or an authorized handoff. Isolate concurrent writers in separate workspaces, using worktrees for Git changes.",
        "After piano_start_session returns, inspect creation, submission and detail. For an authorized handoff to a created child, return its Open session link with any blocker and end the parent turn only when no retained work or requested completion report remains here. Child completion does not start another parent turn.",
        INPUT_GUIDELINE,
      ],
      description:
        "Dispatch work to a fresh, visible Piano session. Supply a non-empty, self-contained brief: objective, relevant findings, decisions and files, constraints, expected output and necessary checks. The new conversation does not inherit this transcript. It inherits this session’s current Piano project (named session group, not folder) at dispatch time, independent of cwd/worktree; inheritProject: false starts ungrouped. An ungrouped parent yields an ungrouped child; an unlisted or ambiguous parent refuses inheritance before creating anything. Later parent moves do not move existing children. cwd defaults to this checkout; a relative cwd is resolved from this checkout. worktree: { branch } makes Piano create a new worktree on that new branch from cwd's repository and start the session there. With worktree, a missing cwd, a non-Git cwd or a branch that exists refuses the start and creates no session. Worktrunk hooks are skipped unless worktree.hooks is true; then an unapproved hook refuses the start, and a failed hook may leave the new checkout on disk (see detail). Always uses normal new-session model and effort defaults, not the parent's settings. Returns creation (created; refused, when no session exists because Piano refused the start or never received it; or uncertain, when one may), submission (what Pi did with the brief: started, queued, handled, needs_input, rejected, not_sent or uncertain), a handle for observation with piano_wait_sessions, the created worktree, and an Open session link. Creation/admission is not completion. refused with submission not_sent means nothing was started: fix the cause in detail before dispatching again. created with submission rejected or not_sent means the session exists without an accepted brief: report its link and the delivery failure. On uncertain creation or delivery inspect Piano before trying again: never automatically repeat dispatch.",
      parameters: StartParameters,
      outputSchema: StartOutput,
      async execute(_id, params: Static<typeof StartParameters>, signal, _update, ctx) {
        if (!params.prompt.trim())
          throw new Error("A non-empty, self-contained work brief is required.");
        return invoke(signal, async (observationSignal) => {
          const result = await startSession(
            {
              prompt: params.prompt,
              cwd: dispatchDirectory(params.cwd, ctx.cwd),
              worktree: params.worktree,
              inheritProject: params.inheritProject,
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
      promptGuidelines: [
        "Use piano_session_status for a one-time status read by session ID, including after a lost reply or when a wait handle can no longer be used. For completion with a valid dispatch handle, use piano_wait_sessions rather than polling.",
        INPUT_GUIDELINE,
      ],
      description:
        "Read what a Piano session is doing and what it needs, by session ID, without waiting or opening it. Works for any session Piano lists, after a lost reply or a Piano restart. Returns disposition (running, needs_input, settled, exited or unknown) with since, what a needs_input session asks for, the last turn's final answer (bounded) or null, changes (branch, changed file count, linked pull request) and the session link. settled means execution stopped, not that the task succeeded; unknown means delivery or completion could not be established. Reads only: never starts Pi, resumes work or resends input. Current status does not attribute an answer to an earlier dispatch.",
      parameters: StatusParameters,
      outputSchema: StatusOutput,
      async execute(_id, params: Static<typeof StatusParameters>, signal) {
        return invoke(signal, async (readSignal) => {
          const reply = await readStatus({ sessionId: params.sessionId }, environment, readSignal);
          if (reply.status !== "ready") throw new Error(reply.detail);
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
      promptSnippet: "Wait for child results required to complete the parent's task",
      promptGuidelines: [
        "When you retain delivery, use piano_wait_sessions for required child results, including when the user asks for completion here. Do independent work first, then wait when blocked.",
        "After piano_wait_sessions returns, inspect each result's status, answer and detail and evaluate the evidence against the child's completion check before delivering the requested outcome here. An attention outcome can leave other children running; continue waiting only for still-needed, running children using their existing handles.",
        INPUT_GUIDELINE,
      ],
      description:
        "Observe dispatched work using the exact handles returned by piano_start_session. Omit timeoutMs: one call stays open until all sessions finish or any needs input, fails, is cancelled or becomes unobservable. Do not poll with repeated short waits or status reads when you need completion. Only set timeoutMs (1000–60000) for an explicitly bounded observation. Returns every handle's current result with running, settled, failed, cancelled, needs_input or unknown status, answer or null, and Open session links. ending=deadline is an observation limit, not child failure. Cancelling this wait only closes observation; children keep running. Lost connections and unreadable state have bounded recovery. Later input, a restarted host or missing evidence may prevent attribution; inspect that session instead. Settlement does not certify task/check success, handled input may have no answer, and child completion does not wake a parent whose turn has ended. When called through codemode, await the call and omit the script timeout too.",
      parameters: WaitParameters,
      outputSchema: WaitOutput,
      async execute(_id, params: Static<typeof WaitParameters>, signal) {
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
