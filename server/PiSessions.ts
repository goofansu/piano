/**
 * PiSessions: one running `pi --mode rpc` child per session, behind a small
 * interface in the browser's own vocabulary (SessionEvent / SessionAction).
 *
 * Behind the seam: command construction, strict JSONL framing, request
 * correlation, streaming reconstruction, dialog retention, state tracking,
 * fan-out to any number of subscribers, stderr capture, exit handling and
 * orderly shutdown. The only external seam is ChildProcessSpawner.
 */
import { type Cause, Context, Data, Deferred, Effect, Layer, PubSub, Queue, Ref, Scope, Semaphore, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner as Spawner } from "effect/process";

const ChildProcessSpawner = Spawner.ChildProcessSpawner;
type ChildProcessSpawner = Spawner.ChildProcessSpawner;
import type { Dialog, Snapshot, SessionAction, SessionEvent, SessionState } from "../shared/wire.ts";
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
  readonly reason: "spawn" | "exited" | "protocol" | "rejected";
  readonly detail: string;
}> {}

export interface PiSession {
  readonly spec: PiSessionSpec;
  /** A snapshot first, then live events, until `closed` or the subscriber's scope ends. */
  readonly events: Stream.Stream<SessionEvent>;
  /** Apply a browser action. Fails only when pi rejects it or the child is gone. */
  readonly act: (action: SessionAction) => Effect.Effect<void, PiSessionError>;
  /** Current state without subscribing. */
  readonly state: Effect.Effect<SessionState>;
}

export interface ProbeResult {
  readonly models: ReadonlyArray<{ provider: string; id: string; name?: string; reasoning: boolean; contextWindow: number }>;
  readonly defaultModel?: string;
  readonly defaultThinkingLevel?: string;
}

export class PiSessions extends Context.Service<
  PiSessions,
  {
    /** Spawn pi for a session. The child lives as long as the calling Scope. */
    readonly open: (spec: PiSessionSpec) => Effect.Effect<PiSession, PiSessionError, Scope.Scope>;
    /** One-shot `pi --mode rpc --no-session`: available models and pi's default. */
    readonly probe: (cwd: string) => Effect.Effect<ProbeResult, PiSessionError>;
  }
>()("piano/PiSessions") {}

// ── Implementation ───────────────────────────────────────────────────────────

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
  sessionFile?: string;
  sessionId: string;
  sessionName?: string;
}

const toState = (s: RawState): SessionState => ({
  sessionId: s.sessionId,
  sessionFile: s.sessionFile,
  sessionName: s.sessionName,
  model: s.model ? `${s.model.provider}/${s.model.id}` : undefined,
  thinkingLevel: s.thinkingLevel,
  isStreaming: s.isStreaming,
});

/** A spawned pi child with request correlation. Everything above builds on `request` and `records`. */
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
        if (record.type === "response" && typeof record.id === "string" && pending.has(record.id)) {
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
      Effect.flatMap((code) => finish(`pi exited with code ${code}${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ""}`)),
      Effect.catchCause((cause) => finish(`pi exit could not be observed: ${String(cause)}`)),
      Effect.forkScoped,
    );

    // Orderly shutdown: close stdin, give pi a moment, then kill.
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
        yield* write({ id, ...command });
        return yield* Deferred.await(d);
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

    // Ready check and initial transcript. Both race the child exiting early.
    const initial = yield* Effect.all([
      child.request({ type: "get_state" }),
      child.request({ type: "get_messages" }),
    ]).pipe(
      Effect.race(
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

    const patchState = (patch: Partial<SessionState>) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(stateRef);
        const next = { ...current, ...patch };
        if (JSON.stringify(next) === JSON.stringify(current)) return;
        yield* apply([{ _tag: "state", state: next }]);
      });

    /** Context usage and cost from pi; best effort, never fails. */
    const refreshStats = child.request({ type: "get_session_stats" }).pipe(
      Effect.flatMap((data) => {
        const stats = data as RawStats;
        return patchState({ context: stats.contextUsage, cost: stats.cost });
      }),
      Effect.ignore,
    );

    const onRecord = (record: PiRecord) =>
      Effect.gen(function* () {
        switch (record.type) {
          case "agent_start":
            return yield* patchState({ isStreaming: true });
          case "agent_settled":
            yield* patchState({ isStreaming: false });
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
            return yield* apply([{ _tag: "notice", level: "warning", message: `Retrying (${record.attempt}/${record.maxAttempts}): ${record.errorMessage}` }]);
          case "compaction_start":
            return yield* apply([{ _tag: "notice", level: "info", message: `Compacting context (${record.reason})` }]);
          case "extension_error":
            return yield* apply([{ _tag: "notice", level: "error", message: `Extension error: ${record.error}` }]);
          default:
            return yield* apply(assembler.handle(record));
        }
      });

    yield* Stream.fromQueue(child.records).pipe(Stream.runForEach(onRecord), Effect.ignore, Effect.forkScoped);

    // Subscribers learn exactly once that pi is gone: from the child's own exit (a crash),
    // or from this scope closing (a deliberate release), whichever comes first. The
    // finalizer is registered after the child's, so it runs before pi is shut down.
    let announced = false;
    const announceClosed = (reason: string) =>
      Effect.suspend(() => {
        if (announced) return Effect.void;
        announced = true;
        return apply([{ _tag: "closed", reason }]);
      });
    yield* Effect.addFinalizer(() => announceClosed("released"));
    yield* Deferred.await(child.exited).pipe(Effect.flatMap(announceClosed), Effect.forkScoped);

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

    const act = (action: SessionAction): Effect.Effect<void, PiSessionError> =>
      Effect.gen(function* () {
        switch (action._tag) {
          case "prompt": {
            const streaming = (yield* Ref.get(stateRef)).isStreaming;
            yield* child.request({ type: streaming ? "follow_up" : "prompt", message: action.text }).pipe(
              Effect.catchTag("PiSessionError", (e) =>
                // Our streaming flag can lag pi's by one event; retry as a follow-up once.
                !streaming && e.reason === "rejected" && /streaming/i.test(e.detail)
                  ? child.request({ type: "follow_up", message: action.text })
                  : Effect.fail(e),
              ),
            );
            return;
          }
          case "abort":
            yield* child.request({ type: "abort" });
            return;
          case "set_model": {
            const slash = action.model.indexOf("/");
            if (slash <= 0) return yield* new PiSessionError({ reason: "rejected", detail: `Model must be provider/id, got "${action.model}"` });
            const data = (yield* child.request({
              type: "set_model",
              provider: action.model.slice(0, slash),
              modelId: action.model.slice(slash + 1),
            })) as { provider?: string; id?: string } | undefined;
            yield* patchState({ model: data?.provider && data.id ? `${data.provider}/${data.id}` : action.model });
            return;
          }
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
      Effect.race(
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
