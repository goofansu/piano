/**
 * PiSessions: one running `pi --mode rpc` child per session, behind a small
 * interface in the browser's own vocabulary (SessionEvent / SessionAction).
 *
 * Behind the seam: command construction, strict JSONL framing, request
 * correlation, streaming reconstruction, dialog retention, state tracking,
 * fan-out to any number of subscribers, stderr capture, exit handling and
 * orderly shutdown. The only external seam is ChildProcessSpawner.
 */
import { type Cause, Context, Data, Deferred, Effect, Fiber, Layer, PubSub, Queue, Ref, Scope, Semaphore, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner as Spawner } from "effect/process";

const ChildProcessSpawner = Spawner.ChildProcessSpawner;
type ChildProcessSpawner = Spawner.ChildProcessSpawner;
import type { Dialog, PromptSubmission, QueuedMessage, Snapshot, SessionAction, SessionActionResult, SessionEvent, SessionState } from "../shared/wire.ts";
import { PiCli } from "./PiCli.ts";
import { type PiRecord, type RawMessage, serializeMessages, StreamAssembler } from "./PiRecords.ts";

// ── Interface ────────────────────────────────────────────────────────────────

export interface PiSessionSpec {
  readonly cwd: string;
  readonly sessionId: string;
  /** "provider/id" passed as --model */
  readonly model?: string;
  /** Passed as --thinking */
  readonly thinkingLevel?: string;
  /** Passed as --name; callers pass it only for a brand-new session. */
  readonly name?: string;
}

export class PiSessionError extends Data.TaggedError("PiSessionError")<{
  readonly reason: "spawn" | "exited" | "protocol" | "rejected" | "timeout";
  readonly detail: string;
}> {}

export interface PiSession {
  readonly spec: PiSessionSpec;
  /** A snapshot first, then live events, until `closed` or the subscriber's scope ends. */
  readonly events: Stream.Stream<SessionEvent>;
  /** Apply a browser action; command results belong only to the requesting caller. */
  readonly act: (action: SessionAction) => Effect.Effect<void | SessionActionResult, PiSessionError>;
  /** Current state without subscribing. */
  readonly state: Effect.Effect<SessionState>;
}

export interface ProbeResult {
  readonly models: ReadonlyArray<{
    provider: string;
    id: string;
    name?: string;
    reasoning: boolean;
    contextWindow: number;
    /** Pi's per-model effort table: null disables a level, a value enables xhigh or max. */
    thinkingLevelMap?: Record<string, string | null | undefined>;
  }>;
  readonly defaultModel?: string;
  readonly defaultThinkingLevel?: string;
}

export class PiSessions extends Context.Service<
  PiSessions,
  {
    /** Spawn Pi for a session. The child lives as long as the calling Scope. */
    readonly open: (spec: PiSessionSpec) => Effect.Effect<PiSession, PiSessionError, Scope.Scope>;
    /** One-shot `pi --mode rpc --no-session`: available models and Pi's default. */
    readonly probe: (cwd: string) => Effect.Effect<ProbeResult, PiSessionError>;
  }
>()("piano/PiSessions") {}

// ── Implementation ───────────────────────────────────────────────────────────

/** Host acknowledgement deadline, not a deadline for model work or extension execution. */
export const PiRequestTimeoutMs = Context.Reference<number>("piano/PiRequestTimeoutMs", { defaultValue: () => 30_000 });

const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);
const encoder = new TextEncoder();

interface Response extends PiRecord {
  type: "response";
  command: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

interface RawStats {
  cost?: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
}

interface RawState {
  model?: { provider: string; id: string };
  thinkingLevel?: string;
  isStreaming: boolean;
  isCompacting?: boolean;
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
}

const queuedMessagesOf = (value: unknown): ReadonlyArray<QueuedMessage> | undefined => {
  if (!value || typeof value !== "object") return;
  const { steering, followUp } = value as { steering?: unknown; followUp?: unknown };
  if (!Array.isArray(steering) || !Array.isArray(followUp) ||
      ![...steering, ...followUp].every((text) => typeof text === "string")) return;
  return [
    ...steering.map((text: string) => ({ kind: "steering" as const, text })),
    ...followUp.map((text: string) => ({ kind: "follow-up" as const, text })),
  ];
};

const toState = (s: RawState): SessionState => ({
  sessionId: s.sessionId,
  sessionFile: s.sessionFile,
  sessionName: s.sessionName,
  model: s.model ? `${s.model.provider}/${s.model.id}` : undefined,
  thinkingLevel: s.thinkingLevel,
  isStreaming: s.isStreaming,
  isCompacting: s.isCompacting ?? false,
  isRetrying: false,
  queuedMessages: [],
});

/** A spawned Pi child with request correlation. Everything above builds on `request` and `records`. */
interface Child {
  readonly request: (command: Record<string, unknown>) => Effect.Effect<unknown, PiSessionError>;
  readonly write: (record: Record<string, unknown>) => Effect.Effect<void, PiSessionError>;
  /** Every non-response record, in stdout order. Ends when the child exits. */
  readonly records: Queue.Dequeue<PiRecord, Cause.Done>;
  readonly exited: Deferred.Deferred<string>;
}

const debug = (...a: unknown[]) => { if (process.env.PIANO_DEBUG) console.error("[PiSessions]", ...a); };

const spawnChild = (args: ReadonlyArray<string>, cwd: string) =>
  Effect.gen(function* () {
    const cli = yield* PiCli;
    const timeoutMs = yield* PiRequestTimeoutMs;
    debug("spawning", cli.node, cli.cli, args);
    const stdin = yield* Queue.unbounded<Uint8Array, Cause.Done>();
    const records = yield* Queue.unbounded<PiRecord, Cause.Done>();
    const pending = new Map<string, Deferred.Deferred<unknown, PiSessionError>>();
    const exited = yield* Deferred.make<string>();
    let stderr = "";
    let closed = false;
    let seq = 0;

    const handle = yield* ChildProcess.make(cli.node, [cli.cli, "--mode", "rpc", ...args, ...cli.extraArgs], {
      cwd,
      extendEnv: true,
      stdin: Stream.fromQueue(stdin),
      stdout: "pipe",
      stderr: "pipe",
    }).pipe(Effect.mapError((e) => new PiSessionError({ reason: "spawn", detail: String(e) })));
    debug("spawned pid", handle.pid);

    const onLine = (line: string) =>
      Effect.gen(function* () {
        let record: PiRecord;
        debug("line", line.slice(0, 120));
        try {
          record = JSON.parse(line.endsWith("\r") ? line.slice(0, -1) : line) as PiRecord;
        } catch {
          return;
        }
        if (record.type === "response") {
          // Late/unmatched acknowledgements must not become session activity.
          if (typeof record.id !== "string" || !pending.has(record.id)) return;
          const d = pending.get(record.id) as Deferred.Deferred<unknown, PiSessionError>;
          pending.delete(record.id);
          const r = record as Response;
          if (r.success) yield* Deferred.succeed(d, r.data);
          else yield* Deferred.fail(d, new PiSessionError({ reason: "rejected", detail: r.error ?? r.command }));
          return;
        }
        yield* Queue.offer(records, record);
      });

    yield* handle.stdout.pipe(Stream.decodeText(), Stream.splitLines, Stream.runForEach(onLine)).pipe(
      Effect.ignore,
      Effect.forkScoped,
    );
    yield* handle.stderr.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) => Effect.sync(() => {
        stderr = (stderr + chunk).slice(-8192);
      })),
      Effect.ignore,
      Effect.forkScoped,
    );

    const finish = (reason: string) =>
      Effect.gen(function* () {
        if (closed) return;
        closed = true;
        yield* Deferred.succeed(exited, reason);
        for (const d of pending.values()) {
          yield* Deferred.fail(d, new PiSessionError({ reason: "exited", detail: reason }));
        }
        pending.clear();
        yield* Queue.end(records);
      });

    yield* handle.exitCode.pipe(
      Effect.flatMap((code) => finish(`Pi exited with code ${code}${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ""}`)),
      Effect.catchCause((cause) => finish(`Pi exit could not be observed: ${String(cause)}`)),
      Effect.forkScoped,
    );

    // Orderly shutdown: close stdin, give Pi a moment, then kill.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        if (closed) return;
        yield* Queue.end(stdin);
        const done = yield* Deferred.await(exited).pipe(Effect.timeoutOption("3 seconds"));
        if (done._tag === "None") yield* handle.kill().pipe(Effect.ignore);
      }),
    );

    const write = (record: Record<string, unknown>) =>
      Effect.gen(function* () {
        if (closed) return yield* new PiSessionError({ reason: "exited", detail: yield* Deferred.await(exited) });
        yield* Queue.offer(stdin, encoder.encode(`${JSON.stringify(record)}\n`));
      });

    const request = (command: Record<string, unknown>) =>
      Effect.gen(function* () {
        seq += 1;
        const id = `q${seq}`;
        const d = yield* Deferred.make<unknown, PiSessionError>();
        pending.set(id, d);
        debug("request", id, command.type);
        return yield* write({ id, ...command }).pipe(
          Effect.andThen(Deferred.await(d)),
          Effect.timeoutOrElse({
            duration: timeoutMs,
            orElse: () => Effect.fail(new PiSessionError({ reason: "timeout", detail: `Pi did not acknowledge ${command.type} within ${timeoutMs}ms. Delivery may have occurred; inspect the session before sending again.` })),
          }),
          Effect.ensuring(Effect.sync(() => { pending.delete(id); })),
        );
      });

    const child: Child = { request, write, records, exited };
    return child;
  });

const openSession = (spec: PiSessionSpec) =>
  Effect.gen(function* () {
    const args = ["--session-id", spec.sessionId];
    if (spec.model) args.push("--model", spec.model);
    if (spec.thinkingLevel) args.push("--thinking", spec.thinkingLevel);
    if (spec.name) args.push("--name", spec.name);
    const child = yield* spawnChild(args, spec.cwd);
    const sessionScope = yield* Effect.scope;

    // Ready check and initial transcript. Both race the child exiting early.
    const initial = yield* Effect.all([
      child.request({ type: "get_state" }),
      child.request({ type: "get_messages" }),
    ]).pipe(
      // Readiness failure wins too: race waits for a first success and would
      // suppress a deadline until a still-live child eventually exits.
      Effect.raceFirst(
        Deferred.await(child.exited).pipe(
          Effect.flatMap((reason) => new PiSessionError({ reason: "spawn", detail: reason })),
        ),
      ),
    );
    const stateRef = yield* Ref.make<SessionState>(toState(initial[0] as RawState));
    const messagesRef = yield* Ref.make(
      serializeMessages(((initial[1] as { messages?: RawMessage[] }).messages ?? []) as RawMessage[], "m"),
    );
    const dialogsRef = yield* Ref.make(new Map<string, Dialog>());
    const pubsub = yield* PubSub.unbounded<SessionEvent>();
    const lock = yield* Semaphore.make(1);
    const assembler = new StreamAssembler();
    const metadataFields = ["model", "thinkingLevel", "sessionName", "sessionFile"] as const;
    const factVersions = { model: 0, thinkingLevel: 0, sessionName: 0, sessionFile: 0 };
    let statsVersion = 0;
    let operationVersion = 0;
    let submissionId = 0;
    let turnRetry = false;
    let summaryRetry = false;
    let announced = false;

    /** Update local state and publish, atomically with respect to snapshots. */
    const apply = (events: ReadonlyArray<SessionEvent>) =>
      Semaphore.withPermits(lock, 1)(
        Effect.gen(function* () {
          for (const event of events) {
            switch (event._tag) {
              case "message_end":
                yield* Ref.update(messagesRef, (ms) => [...ms, event.message]);
                break;
              case "state":
                yield* Ref.set(stateRef, event.state);
                break;
              case "queue_update":
                yield* Ref.update(stateRef, (state) => ({ ...state, queuedMessages: event.messages }));
                break;
              case "submission":
                yield* Ref.update(stateRef, (state) => !state.submission || event.submission.id >= state.submission.id
                  ? { ...state, submission: event.submission } : state);
                break;
              case "closed":
                yield* Ref.update(stateRef, (state) => ({ ...state, isStreaming: false, isCompacting: false, isRetrying: false, queuedMessages: [] }));
                break;
              case "dialog":
                yield* Ref.update(dialogsRef, (m) => new Map(m).set(event.dialog.id, event.dialog));
                break;
              case "dialog_resolved":
                yield* Ref.update(dialogsRef, (m) => {
                  const next = new Map(m);
                  next.delete(event.id);
                  return next;
                });
                break;
              default:
                break;
            }
            yield* PubSub.publish(pubsub, event);
          }
        }),
      );

    const patchState = (patch: Partial<SessionState> | (() => Partial<SessionState>)) =>
      Semaphore.withPermits(lock, 1)(Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        const next = { ...current, ...(typeof patch === "function" ? patch() : patch) };
        if (JSON.stringify(next) === JSON.stringify(current)) return;
        for (const field of metadataFields) if (next[field] !== current[field]) factVersions[field] += 1;
        yield* Ref.set(stateRef, next);
        yield* PubSub.publish(pubsub, { _tag: "state", state: next });
      }));

    /** Canonical projected context and billed cost from Pi, not partial response usage.
     * Refresh at persisted boundaries, never per token/delta. Best effort.
     */
    const refreshStats = Effect.gen(function* () {
      const version = ++statsVersion;
      const modelVersion = factVersions.model;
      const stats = (yield* child.request({ type: "get_session_stats" })) as RawStats;
      yield* patchState(() => version === statsVersion && modelVersion === factVersions.model && !announced
        ? { context: stats.contextUsage, cost: stats.cost } : {});
    }).pipe(Effect.ignore);

    /** Read command-controlled facts back from Pi. Do not replace session-level
     * activity with get_state.isStreaming (which describes the low-level run).
     * Neither a stale observation nor an old command may overwrite newer facts.
     */
    const refreshState = (operation: number) => Effect.gen(function* () {
      if (operation !== operationVersion) return;
      const versions = { ...factVersions };
      const raw = (yield* child.request({ type: "get_state" })) as RawState;
      yield* patchState(() => {
        if (operation !== operationVersion || announced) return {};
        const observed = {
          model: raw.model ? `${raw.model.provider}/${raw.model.id}` : undefined,
          thinkingLevel: raw.thinkingLevel,
          sessionName: raw.sessionName,
          sessionFile: raw.sessionFile,
        };
        const patch: Partial<Record<typeof metadataFields[number], string | undefined>> = {};
        // Unrelated streaming/queue events must not discard a model observation.
        for (const field of metadataFields) if (versions[field] === factVersions[field]) patch[field] = observed[field];
        return patch;
      });
    }).pipe(Effect.ignore);

    const onRecord = (record: PiRecord) =>
      Effect.gen(function* () {
        if (announced) return;
        switch (record.type) {
          case "agent_start":
            return yield* patchState({ isStreaming: true });
          case "queue_update": {
            const messages = queuedMessagesOf(record);
            if (!messages) return yield* apply([{ _tag: "notice", level: "warning", message: "Pi sent an invalid queue update." }]);
            return yield* apply([{ _tag: "queue_update", messages }]);
          }
          case "agent_settled":
            turnRetry = false;
            summaryRetry = false;
            yield* patchState({ isStreaming: false, isCompacting: false, isRetrying: false });
            return yield* refreshStats;
          case "message_end":
            yield* apply(assembler.handle(record));
            return yield* refreshStats;
          case "compaction_end":
            yield* patchState({ isCompacting: false });
            // Pi reports null tokens/percent until fresh post-compaction usage exists.
            return yield* refreshStats;
          case "session_info_changed":
            return yield* patchState({ sessionName: record.name as string | undefined });
          case "thinking_level_changed":
            return yield* patchState({ thinkingLevel: record.level as string | undefined });
          case "extension_ui_request": {
            const method = String(record.method);
            if (method === "notify") {
              const level = record.notifyType === "error" ? "error" : record.notifyType === "warning" ? "warning" : "info";
              return yield* apply([{ _tag: "notice", level, message: String(record.message ?? "") }]);
            }
            if (!DIALOG_METHODS.has(method)) return;
            const dialog: Dialog = {
              id: String(record.id),
              method: method as Dialog["method"],
              title: record.title as string | undefined,
              message: record.message as string | undefined,
              options: record.options as string[] | undefined,
              placeholder: record.placeholder as string | undefined,
              prefill: record.prefill as string | undefined,
            };
            return yield* apply([{ _tag: "dialog", dialog }]);
          }
          case "auto_retry_start":
            turnRetry = true;
            yield* patchState({ isStreaming: true, isRetrying: true });
            return yield* apply([{ _tag: "notice", level: "warning", message: `Retrying (${record.attempt}/${record.maxAttempts}): ${record.errorMessage}` }]);
          case "auto_retry_end":
            turnRetry = false;
            return yield* patchState({ isRetrying: summaryRetry });
          case "summarization_retry_scheduled":
            summaryRetry = true;
            yield* patchState({ isRetrying: true });
            return yield* apply([{ _tag: "notice", level: "warning", message: `Retrying summary (${record.attempt}/${record.maxAttempts}): ${record.errorMessage}` }]);
          case "summarization_retry_finished":
            summaryRetry = false;
            return yield* patchState({ isRetrying: turnRetry });
          case "compaction_start":
            yield* patchState({ isCompacting: true });
            return yield* apply([{ _tag: "notice", level: "info", message: `Compacting context (${record.reason})` }]);
          case "extension_error":
            return yield* apply([{ _tag: "notice", level: "error", message: `Extension error: ${record.error}` }]);
          default:
            return yield* apply(assembler.handle(record));
        }
      });

    const recordsDrained = yield* Deferred.make<void>();
    yield* Stream.fromQueue(child.records).pipe(
      Stream.runForEach(onRecord), Effect.ignore,
      Effect.ensuring(Deferred.succeed(recordsDrained, undefined)), Effect.forkScoped,
    );

    // Subscribers learn exactly once that Pi is gone: from the child's own exit (a crash),
    // or from this scope closing (a deliberate release), whichever comes first. The
    // finalizer is registered after the child's, so it runs before Pi is shut down.
    const announceClosed = (reason: string) =>
      Effect.suspend(() => {
        if (announced) return Effect.void;
        announced = true;
        return Effect.gen(function* () {
          const submission = (yield* Ref.get(stateRef)).submission;
          if (submission?.outcome === "submitting") yield* apply([{ _tag: "submission", submission: { ...submission, outcome: "uncertain", detail: `Pi stopped before acknowledging this input: ${reason}` } }]);
          yield* apply([{ _tag: "closed", reason }]);
        });
      });
    yield* Effect.addFinalizer(() => announceClosed("released"));
    // Preserve already-read output before announcing an exit. The record-loop
    // finalizer only signals completion; it never waits for a later child finalizer.
    yield* Deferred.await(child.exited).pipe(
      Effect.flatMap((reason) => Deferred.await(recordsDrained).pipe(Effect.andThen(announceClosed(reason)))),
      Effect.forkScoped,
    );

    const events: Stream.Stream<SessionEvent> = Stream.unwrap(
      Semaphore.withPermits(lock, 1)(
        Effect.gen(function* () {
          const scope = yield* Scope.make();
          const sub = yield* PubSub.subscribe(pubsub).pipe(Scope.provide(scope));
          const snapshot: Snapshot = {
            state: yield* Ref.get(stateRef),
            messages: yield* Ref.get(messagesRef),
            dialogs: [...(yield* Ref.get(dialogsRef)).values()],
          };
          return Stream.make<[SessionEvent]>({ _tag: "snapshot", snapshot }).pipe(
            Stream.concat(Stream.fromSubscription(sub)),
            Stream.takeUntil((e) => e._tag === "closed"),
            Stream.ensuring(Scope.close(scope, { _tag: "Success", value: undefined } as never)),
          );
        }),
      ),
    );

    const act = (action: SessionAction): Effect.Effect<void | SessionActionResult, PiSessionError> =>
      Effect.gen(function* () {
        const operation = ++operationVersion;
        switch (action._tag) {
          case "prompt": {
            const id = ++submissionId;
            const submit = (outcome: PromptSubmission["outcome"], detail?: string) => apply([{ _tag: "submission", submission: { id, outcome, detail } }]);
            // Once dispatched, acknowledgement tracking belongs to the session,
            // not the browser/caller that may disconnect while Pi handles input.
            const work = Effect.gen(function* () {
              yield* submit("submitting");
              yield* child.request({ type: "prompt", message: action.text, streamingBehavior: "followUp" }).pipe(
                Effect.flatMap((data) => {
                  const disposition = (data as { disposition?: unknown } | undefined)?.disposition;
                  if (disposition !== "started" && disposition !== "queued" && disposition !== "handled") {
                    return Effect.fail(new PiSessionError({ reason: "protocol", detail: "Pi acknowledged the input without a recognized disposition. Inspect the session before sending again." }));
                  }
                  return submit(disposition);
                }),
                Effect.catchTag("PiSessionError", (error) => submit(error.reason === "rejected" ? "rejected" : "uncertain", error.detail).pipe(
                  Effect.andThen(Effect.fail(error)),
                )),
              );
              yield* refreshState(operation);
            });
            return yield* work.pipe(Effect.forkIn(sessionScope), Effect.flatMap(Fiber.join));
          }
          case "abort":
            yield* child.request({ type: "abort" });
            return;
          case "restore_queue": {
            const messages = queuedMessagesOf(yield* child.request({ type: "clear_queue" }));
            if (!messages) return yield* new PiSessionError({ reason: "protocol", detail: "Pi returned an invalid cleared queue." });
            return { _tag: "queue_restored", messages };
          }
          case "set_model": {
            const slash = action.model.indexOf("/");
            if (slash <= 0) return yield* new PiSessionError({ reason: "rejected", detail: `Model must be provider/id, got "${action.model}"` });
            yield* child.request({
              type: "set_model",
              provider: action.model.slice(0, slash),
              modelId: action.model.slice(slash + 1),
            });
            yield* refreshState(operation);
            yield* refreshStats;
            return;
          }
          case "set_thinking_level":
            yield* child.request({ type: "set_thinking_level", level: action.level });
            yield* refreshState(operation);
            return;
          case "answer": {
            const known = (yield* Ref.get(dialogsRef)).has(action.id);
            if (!known) return yield* new PiSessionError({ reason: "rejected", detail: `No open dialog ${action.id}` });
            const response: Record<string, unknown> = { type: "extension_ui_response", id: action.id };
            if (action.cancelled) response.cancelled = true;
            else if (action.confirmed !== undefined) response.confirmed = action.confirmed;
            else response.value = action.value ?? "";
            yield* child.write(response);
            yield* apply([{ _tag: "dialog_resolved", id: action.id }]);
            return;
          }
        }
      });

    yield* refreshStats;
    const session: PiSession = { spec, events, act, state: Ref.get(stateRef) };
    return session;
  });

const probe = (cwd: string): Effect.Effect<ProbeResult, PiSessionError, ChildProcessSpawner> =>
  Effect.gen(function* () {
    const child = yield* spawnChild(["--no-session"], cwd);
    const [models, state] = yield* Effect.all([
      child.request({ type: "get_available_models" }),
      child.request({ type: "get_state" }),
    ]).pipe(
      Effect.raceFirst(
        Deferred.await(child.exited).pipe(
          Effect.flatMap((reason) => new PiSessionError({ reason: "spawn", detail: reason })),
        ),
      ),
    );
    const raw = state as RawState;
    return {
      models: ((models as { models?: ProbeResult["models"] }).models ?? []),
      defaultModel: raw.model ? `${raw.model.provider}/${raw.model.id}` : undefined,
      defaultThinkingLevel: raw.thinkingLevel,
    };
  }).pipe(Effect.scoped);

export const PiSessionsLive: Layer.Layer<PiSessions, never, ChildProcessSpawner> = Layer.effect(
  PiSessions,
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner;
    return PiSessions.of({
      open: (spec) => openSession(spec).pipe(Effect.provideService(ChildProcessSpawner, spawner)),
      probe: (cwd) => probe(cwd).pipe(Effect.provideService(ChildProcessSpawner, spawner)),
    });
  }),
);
