/** Bundled Pi tools: dispatch through Piano, never launch or own another Pi process. */
import { type JsonValue, Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  DISPATCH_ENTRY,
  DISPATCHED_FROM_FLAG,
  START_TOOL,
  WAIT_STATUSES,
  WAIT_TOOL,
} from "../../shared/dispatch.ts";
import { ThinkingLevel } from "../../shared/wire.ts";
import { dispatchConfiguration, nodeSocketEnvironment } from "./NodeSocket.ts";
import { startSession, waitSessions } from "./SessionDispatch.ts";

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
  status: Type.Union(WAIT_STATUSES.map((value) => Type.Literal(value))),
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
        "Dispatch work to a fresh, visible Piano session. Supply a non-empty, self-contained brief: objective, relevant decisions/files, constraints, expected output and necessary checks. The new conversation does not inherit this transcript. cwd defaults to this checkout; use separate prepared worktrees for concurrent writing tasks. model is an optional provider/model; thinkingLevel optionally sets reasoning effort supported by that model. Omitted options use normal new-session defaults, not the parent's settings. Returns the initial prompt's disposition, a handle to pass unchanged to piano_wait_sessions, and an Open session link. Creation/admission is not completion. On uncertain delivery inspect Piano before trying again: never automatically repeat dispatch.",
      parameters: Type.Object({
        prompt: Type.String({ minLength: 1, description: "Self-contained work brief" }),
        cwd: Type.Optional(Type.String({ minLength: 1 })),
        model: Type.Optional(Type.String({ minLength: 1 })),
        thinkingLevel: Type.Optional(
          Type.Union(
            ThinkingLevel.literals.map((level) => Type.Literal(level)),
            {
              description: "Reasoning effort; choose a level supported by the selected model.",
            },
          ),
        ),
      }),
      outputSchema: Type.Object({
        cwd: Type.String(),
        creation: Type.Union([
          Type.Literal("created"),
          Type.Literal("refused"),
          Type.Literal("uncertain"),
        ]),
        submission: Type.String(),
        handle: Type.Union([Handle, Type.Null()]),
        detail: Type.Optional(Type.String()),
        link: NullableString,
      }),
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
          return { ...result, link: result.handle ? link(result.handle.sessionId) : null };
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
      parameters: Type.Object({
        sessions: Type.Array(Handle, { minItems: 1, maxItems: 32 }),
        timeoutMs: Type.Optional(Type.Integer({ minimum: 1000, maximum: 60000 })),
      }),
      outputSchema: Type.Object({ results: Type.Array(Observation) }),
      async execute(_id, params, signal) {
        return invoke(signal, async (observationSignal) => {
          const results = await waitSessions(
            params.sessions,
            params.timeoutMs,
            environment,
            observationSignal,
          );
          return {
            results: results.map((result) => ({ ...result, link: link(result.handle.sessionId) })),
          };
        });
      },
    }),
  );
}
