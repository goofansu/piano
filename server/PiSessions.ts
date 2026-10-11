/**
 * PiSessions: one running `pi --mode rpc` child per session, behind a small
 * interface in the browser's own vocabulary (SessionEvent / SessionAction).
 *
 * Behind the seam: command construction, strict JSONL framing, request
 * correlation, streaming reconstruction, dialog retention, state tracking,
 * fan-out to any number of subscribers, stderr capture, exit handling and
 * orderly shutdown. The only external seam is ChildProcessSpawner.
 */
import { randomUUID } from "node:crypto";
import { type Cause, Clock, Context, Data, Deferred, Effect, Fiber, Layer, Queue, Ref, Schema, type Scope, Semaphore, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner as Spawner } from "effect/process";

const ChildProcessSpawner = Spawner.ChildProcessSpawner;
type ChildProcessSpawner = Spawner.ChildProcessSpawner;

import { imageType } from "../shared/attachments.ts";
import { applySessionEvent, isWorking } from "../shared/sessionProjection.ts";
import type { Dialog, DialogResolution, PromptSubmission, QueuedMessage, SessionAction, SessionActionResult, SessionClosure, SessionEvent, SessionFrame, SessionState, SessionStats, Snapshot } from "../shared/wire.ts";
import { Attachments, SlashCommand } from "../shared/wire.ts";
import { type DeliveryOverflow, makeDelivery } from "./BoundedDelivery.ts";
import { projectDisplay } from "./DisplayProjection.ts";
import { PiCli } from "./PiCli.ts";
import { type PiRecord, type RawMessage, StreamAssembler } from "./PiRecords.ts";

// ── Interface ────────────────────────────────────────────────────────────────

export interface PiSessionSpec {
  readonly cwd: string;
  readonly sessionId: string;
  /** Existing Pi file, including an old alias-based reference. Never copied or moved. */
  readonly sessionFile?: string;
  /** "provider/id" passed as --model */
  readonly model?: string;
  /** Passed as --thinking */
  readonly thinkingLevel?: string;
  /** Passed as --name; callers pass it only for a brand-new session. */
  readonly name?: string;
  /** Seed only display statistics while Pi's authoritative readback is pending. */
  readonly lastKnownStats?: SessionStats;
}

export class PiSessionError extends Data.TaggedError("PiSessionError")<{
  readonly reason: "spawn" | "exited" | "protocol" | "rejected" | "timeout" | "transport";
  readonly detail: string;
}> {}

export interface PiSession {
  readonly spec: PiSessionSpec;
  /** Atomic snapshot/cursor first, then contiguous live frames until closed.
   * A subscriber exceeding 256 queued frames / 8 MiB fails DeliveryOverflow;
   * attach again for a current snapshot, never replay commands or old deltas. */
  readonly events: Stream.Stream<SessionFrame, DeliveryOverflow>;
  /** Apply a browser action; command results belong only to the requesting caller. */
  readonly act: (action: SessionAction) => Effect.Effect<SessionActionResult | undefined, PiSessionError>;
  /** Current state without subscribing. */
  readonly state: Effect.Effect<SessionState>;
}

export interface ProbeResult {
  readonly commands: ReadonlyArray<SlashCommand>;
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
    readonly probe: (cwd: string, options?: { globalSettingsOnly?: boolean }) => Effect.Effect<ProbeResult, PiSessionError>;
  }
>()("piano/PiSessions") {}

// ── Implementation ───────────────────────────────────────────────────────────

/** Keep Pi's execution precedence, exposing only browser-useful catalog fields. */
const commandsOf = (data: unknown): Effect.Effect<ReadonlyArray<SlashCommand>, PiSessionError> => {
  const commands = (data as { commands?: unknown } | undefined)?.commands;
  if (!Schema.is(Schema.Array(SlashCommand))(commands)) return Effect.fail(new PiSessionError({ reason: "protocol", detail: "Pi returned an invalid command catalog." }));
  const unique = new Map<string, SlashCommand>();
  // Extensions execute before skills and templates; skills expand before templates.
  for (const source of ["extension", "skill", "prompt"] as const) for (const command of commands) {
    if (command.source === source && !unique.has(command.name)) unique.set(command.name, {
      name: command.name, description: command.description, source,
    });
  }
  return Effect.succeed([...unique.values()]);
};

/** Host acknowledgement deadline, not a deadline for model work or extension execution. */
export const PiRequestTimeoutMs = Context.Reference<number>("piano/PiRequestTimeoutMs", { defaultValue: () => 30_000 });

/** Bounded recovery for dialogs whose extension-owned cancellation is invisible over RPC. */
export const PiDialogRecoveryMs = Context.Reference<number>("piano/PiDialogRecoveryMs", { defaultValue: () => 10 * 60_000 });

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
  tokens?: SessionState["tokens"];
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

/** Retained state shows nothing Pi could still continue on its own or that awaits an answer. */
const settled = ({ state, dialogs }: Snapshot) => dialogs.length === 0 && !isWorking(state) && !state.isStopping &&
  !state.queuedMessages?.length && state.dialogResolution?.delivery !== "pending" && state.dialogResolution?.delivery !== "uncertain" &&
  state.submission?.outcome !== "submitting" && state.submission?.outcome !== "uncertain";

/** A spawned Pi child with request correlation. Everything above builds on `request` and `records`. */
interface Child {
  readonly request: (command: Record<string, unknown>, dispatched?: Deferred.Deferred<void>) => Effect.Effect<unknown, PiSessionError>;
  readonly write: (record: Record<string, unknown>) => Effect.Effect<void, PiSessionError>;
  /** Every non-response record, in stdout order. Ends when the child exits. */
  readonly records: Queue.Dequeue<{ record: PiRecord; receivedAt: number }, Cause.Done>;
  readonly exited: Deferred.Deferred<SessionClosure>;
  /** Includes queued records, so readbacks cannot race output not yet projected. */
  readonly observationVersion: () => number;
  readonly hasPendingWork: () => boolean;
}

const debug = (...a: unknown[]) => { if (process.env.PIANO_DEBUG) console.error("[PiSessions]", ...projectDisplay(a)); };

const spawnChild = (args: ReadonlyArray<string>, cwd: string) =>
  Effect.gen(function* () {
    const cli = yield* PiCli;
    const timeoutMs = yield* PiRequestTimeoutMs;
    debug("spawning", cli.node, cli.cli, args);
    const stdin = yield* Queue.unbounded<{ bytes: Uint8Array; done: Deferred.Deferred<void, PiSessionError> }, Cause.Done>();
    const records = yield* Queue.unbounded<{ record: PiRecord; receivedAt: number }, Cause.Done>();
    const writes = new Set<Deferred.Deferred<void, PiSessionError>>();
    let transportError: PiSessionError | undefined;
    const pending = new Map<string, Deferred.Deferred<unknown, PiSessionError>>();
    const exited = yield* Deferred.make<SessionClosure>();
    let stderr = "";
    let closed = false;
    let seq = 0;
    let observationVersion = 0;
    let uncertainMutation = false;
    let uncertainWrite = false;

    const handle = yield* ChildProcess.make(cli.node, [cli.cli, "--mode", "rpc", ...args, ...cli.extraArgs], {
      cwd,
      extendEnv: true,
      // Development only: `npm run dev` (node --watch) sets WATCH_REPORT_DEPENDENCIES=1, and Pi's
      // image-resize worker then mistakes Node's dependency-watch message for its result and
      // reports a bogus size-limit omission. `npm start` and the hosted service never set it (INV-12).
      env: { WATCH_REPORT_DEPENDENCIES: undefined },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      forceKillAfter: "1 second",
    }).pipe(Effect.mapError((e) => new PiSessionError({ reason: "spawn", detail: String(e) })));
    debug("spawned pid", handle.pid);

    const onLine = (line: string) =>
      Effect.gen(function* () {
        let record: PiRecord;
        try {
          record = JSON.parse(line.endsWith("\r") ? line.slice(0, -1) : line) as PiRecord;
        } catch {
          return;
        }
        debug("record", record.type); // Never log unprojected protocol content.
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
        observationVersion += 1;
        yield* Queue.offer(records, { record, receivedAt: yield* Clock.currentTimeMillis });
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

    const finish = (closure: SessionClosure) =>
      Effect.gen(function* () {
        if (closed) return;
        closed = true;
        const reason = closure.detail;
        yield* Deferred.succeed(exited, closure);
        for (const d of pending.values()) {
          yield* Deferred.fail(d, new PiSessionError({ reason: "exited", detail: reason }));
        }
        pending.clear();
        for (const done of writes) yield* Deferred.fail(done, new PiSessionError({ reason: "exited", detail: reason }));
        yield* Queue.end(records);
      });

    yield* handle.exitCode.pipe(
      Effect.flatMap((code) => finish({ _tag: "exited", code, detail: `Pi exited with code ${code}${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ""}` })),
      Effect.catchCause((cause) => finish({ _tag: "failed", detail: `Pi exit could not be observed: ${String(cause)}` })),
      Effect.forkScoped,
    );

    // Acknowledge a write only after the sink has pulled its bytes and accepted
    // them with backpressure. This still cannot prove Pi consumed a UI response.
    yield* Stream.fromQueue(stdin).pipe(
      Stream.flatMap(({ bytes, done }) => Stream.make(bytes).pipe(
        Stream.concat(Stream.fromEffect(Deferred.succeed(done, undefined)).pipe(Stream.drain)),
      )),
      Stream.run(handle.stdin),
      Effect.catchCause((cause) => Effect.gen(function* () {
        transportError = new PiSessionError({ reason: "transport", detail: `Pi stdin failed; delivery is uncertain: ${String(cause)}` });
        for (const done of writes) yield* Deferred.fail(done, transportError);
        for (const d of pending.values()) yield* Deferred.fail(d, transportError);
      })),
      Effect.forkScoped,
    );

    // Orderly shutdown: close stdin, give Pi a moment, then kill.
    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        if (closed) return;
        yield* Queue.end(stdin);
        const done = yield* Deferred.await(exited).pipe(Effect.timeoutOption("3 seconds"));
        if (done._tag === "None") yield* handle.kill({ forceKillAfter: "1 second" }).pipe(Effect.ignore);
      }),
    );

    const write = (record: Record<string, unknown>) =>
      Effect.gen(function* () {
        if (closed) return yield* new PiSessionError({ reason: "exited", detail: (yield* Deferred.await(exited)).detail });
        if (transportError) return yield* transportError;
        const done = yield* Deferred.make<void, PiSessionError>();
        writes.add(done);
        yield* Queue.offer(stdin, { bytes: encoder.encode(`${JSON.stringify(record)}\n`), done });
        yield* Deferred.await(done).pipe(
          Effect.timeoutOrElse({ duration: timeoutMs, orElse: () => Effect.fail(new PiSessionError({ reason: "transport", detail: "Pi stdin write timed out; delivery is uncertain. Do not resend this response." })) }),
          Effect.tapError(() => Effect.sync(() => { uncertainWrite = true; })),
          Effect.ensuring(Effect.sync(() => { writes.delete(done); })),
        );
      });

    const request = (command: Record<string, unknown>, dispatched?: Deferred.Deferred<void>) =>
      Effect.gen(function* () {
        seq += 1;
        const id = `q${seq}`;
        const d = yield* Deferred.make<unknown, PiSessionError>();
        pending.set(id, d);
        debug("request", id, command.type);
        return yield* write({ id, ...command }).pipe(
          Effect.ensuring(dispatched ? Deferred.succeed(dispatched, undefined) : Effect.void),
          Effect.andThen(Deferred.await(d)),
          Effect.timeoutOrElse({
            duration: timeoutMs,
            orElse: () => Effect.fail(new PiSessionError({ reason: "timeout", detail: `Pi did not acknowledge ${command.type} within ${timeoutMs}ms. Delivery may have occurred; inspect the session before sending again.` })),
          }),
          Effect.tapError(error => Effect.sync(() => {
            // Timeout is not cancellation. A newer successful command cannot
            // establish that an older, unacknowledged mutation stopped running.
            if (!String(command.type).startsWith("get_") && error.reason !== "rejected") uncertainMutation = true;
          })),
          Effect.ensuring(Effect.sync(() => { pending.delete(id); })),
        );
      });

    const child: Child = { request, write, records, exited, observationVersion: () => observationVersion,
      hasPendingWork: () => pending.size > 0 || writes.size > 0 || uncertainMutation || uncertainWrite,
    };
    return child;
  });

const openSession = (spec: PiSessionSpec) =>
  Effect.gen(function* () {
    const args = spec.sessionFile ? ["--session", spec.sessionFile] : ["--session-id", spec.sessionId];
    if (spec.model) args.push("--model", spec.model);
    if (spec.thinkingLevel) args.push("--thinking", spec.thinkingLevel);
    if (spec.name) args.push("--name", spec.name);
    const child = yield* spawnChild(args, spec.cwd);
    const sessionScope = yield* Effect.scope;
    const generation = randomUUID();
    const recoveryMs = yield* PiDialogRecoveryMs;

    // Ready check and initial transcript. Both race the child exiting early.
    const initial = yield* Effect.all([
      child.request({ type: "get_state" }),
      child.request({ type: "get_messages" }),
    ]).pipe(
      // Readiness failure wins too: race waits for a first success and would
      // suppress a deadline until a still-live child eventually exits.
      Effect.raceFirst(
        Deferred.await(child.exited).pipe(
          Effect.flatMap((closure) => new PiSessionError({ reason: "spawn", detail: closure.detail })),
        ),
      ),
    );
    if ((initial[0] as RawState).sessionId !== spec.sessionId) return yield* new PiSessionError({ reason: "protocol", detail: "Pi opened a different session ID. History was not merged; check the saved reference." });
    const assembler = new StreamAssembler();
    // Everything a subscriber's snapshot holds except host observations, kept by the shared fold.
    const snapshotRef = yield* Ref.make<Snapshot>({
      state: { ...toState(initial[0] as RawState), ...spec.lastKnownStats, contextIsLastKnown: true },
      messages: assembler.serializeMessages(((initial[1] as { messages?: RawMessage[] }).messages ?? []) as RawMessage[], "m"),
      dialogs: [],
      tools: [],
    });
    const stateOf = Effect.map(Ref.get(snapshotRef), snapshot => snapshot.state);
    const dialogsOf = Effect.map(Ref.get(snapshotRef), snapshot => snapshot.dialogs);
    const subscribers = new Set<Effect.Success<ReturnType<typeof makeDelivery<SessionFrame>>>>();
    let sequence = 0;
    const cursor = () => ({ cwd: spec.cwd, sessionId: spec.sessionId, generation, sequence });
    // All callers hold the snapshot lock. Never await a consumer here.
    const publish = (event: SessionEvent) => Effect.gen(function* () {
      yield* Ref.update(snapshotRef, snapshot => applySessionEvent(snapshot, event));
      sequence++;
      const frame: SessionFrame = { ...projectDisplay(event), cursor: cursor() };
      for (const subscriber of subscribers) yield* subscriber.offer(frame);
    });
    const lock = yield* Semaphore.make(1);
    const metadataFields = ["model", "thinkingLevel", "sessionName", "sessionFile"] as const;
    const factVersions = { model: 0, thinkingLevel: 0, sessionName: 0, sessionFile: 0 };
    let statsVersion = 0;
    let contextVersion = 0;
    let operationVersion = 0;
    let submissionId = 0;
    let turnRetry = false;
    let summaryRetry = false;
    let announced = false;
    let processedVersion = 0;
    const seenDialogs = new Set<string>();
    const dialogClosed = new Map<string, Deferred.Deferred<void>>();
    const promptOperations = new Set<number>();
    let aborting: { dispatched: Deferred.Deferred<void>; pendingPrompts: Set<number>; acknowledged: boolean } | undefined;

    /** Fold and publish, atomically with respect to snapshots. */
    const apply = (events: ReadonlyArray<SessionEvent> | (() => ReadonlyArray<SessionEvent>)) =>
      Semaphore.withPermits(lock, 1)(
        Effect.gen(function* () {
          for (const event of typeof events === "function" ? events() : events) yield* publish(event);
        }),
      );

    const patchState = (patch: Partial<SessionState> | (() => Partial<SessionState>)) =>
      Semaphore.withPermits(lock, 1)(Effect.gen(function* () {
        const current = yield* stateOf;
        const next = { ...current, ...(typeof patch === "function" ? patch() : patch) };
        if (isWorking(next) || next.model !== current.model) next.contextIsLastKnown = true;
        if (JSON.stringify(next) === JSON.stringify(current)) return;
        for (const field of metadataFields) if (next[field] !== current[field]) factVersions[field] += 1;
        yield* publish({ _tag: "state", state: next });
      }));

    /** All terminal paths compete under the snapshot lock, before any transport yield. */
    const resolveDialog = (dialog: Dialog, reason: DialogResolution["reason"], response?: Record<string, unknown>) => Effect.gen(function* () {
      const resolution = yield* Semaphore.withPermits(lock, 1)(Effect.gen(function* () {
        if (!(yield* dialogsOf).some(open => open.id === dialog.id)) return;
        const now = yield* Clock.currentTimeMillis;
        if ((reason === "answered" || reason === "cancelled") && now >= dialog.deadlineAt) {
          reason = dialog.deadlineKind === "pi-timeout" ? "expired" : "recovery";
        }
        const send = reason !== "expired" && reason !== "exited";
        const detail = reason === "expired"
          ? "Estimated Pi deadline elapsed. Pi owns the actual timeout; no closure acknowledgement is available."
          : reason === "exited" ? "Pi stopped before this dialog was answered. No response sent."
          : reason === "recovery" ? "Host recovery deadline elapsed; cancelling an unconfirmed dialog."
          : reason === "aborted" ? "Abort current: cancelling this dialog. Pending queue is not cleared."
          : "Response claimed locally; waiting for transport delivery.";
        const resolution: DialogResolution = { id: dialog.id, generation, reason, delivery: send ? "pending" : "not-sent", detail };
        const closed = dialogClosed.get(dialog.id);
        if (closed) yield* Deferred.succeed(closed, undefined);
        dialogClosed.delete(dialog.id);
        yield* publish({ _tag: "dialog_resolved", resolution });
        yield* publish({ _tag: "state", state: { ...yield* stateOf, dialogResolution: resolution } });
        return resolution;
      }));
      if (!resolution || resolution.delivery === "not-sent") return resolution;
      const result = yield* child.write({ type: "extension_ui_response", id: dialog.id,
        ...(resolution.reason === "answered" ? response : { cancelled: true }),
      }).pipe(Effect.result);
      const final: DialogResolution = { ...resolution,
        delivery: result._tag === "Success" ? "written" : "uncertain",
        detail: result._tag === "Success"
          ? `${resolution.reason === "answered" ? "Answer" : "Cancellation"} written to Pi. Consumption is unconfirmed; Pi sends no UI acknowledgement.`
          : `Dialog response delivery is uncertain. It will not be retried or reopened. Inspect the session; restart Pi if blocked. ${result.failure.detail}`,
      };
      yield* Semaphore.withPermits(lock, 1)(Effect.gen(function* () {
        const state = yield* stateOf;
        if (state.dialogResolution?.id === dialog.id && !announced) yield* publish({ _tag: "state", state: { ...state, dialogResolution: final } });
        if (result._tag === "Failure") yield* publish({ _tag: "notice", level: "error", message: final.detail });
      }));
      if (result._tag === "Failure") return yield* result.failure;
      return final;
    });

    const endAbortingPrompt = (operation: number) => Effect.sync(() => {
      promptOperations.delete(operation);
      aborting?.pendingPrompts.delete(operation);
      if (aborting?.acknowledged && aborting.pendingPrompts.size === 0) aborting = undefined;
    });

    /** Canonical projected context and billed cost from Pi, not partial response usage.
     * Refresh at persisted boundaries, never per token/delta. Best effort.
     */
    const refreshStats = Effect.gen(function* () {
      const version = ++statsVersion;
      const modelVersion = factVersions.model;
      const outputVersion = child.observationVersion();
      yield* patchState({ contextIsLastKnown: true });
      yield* Effect.gen(function* () {
        const stats = (yield* child.request({ type: "get_session_stats" })) as RawStats;
        const statsUpdatedAt = yield* Clock.currentTimeMillis;
        yield* patchState(() => version === statsVersion && modelVersion === factVersions.model && !announced
          ? { context: stats.contextUsage, cost: stats.cost, tokens: stats.tokens, statsUpdatedAt,
              contextIsLastKnown: outputVersion !== child.observationVersion(), statsRefreshError: undefined } : {});
      }).pipe(Effect.catchTag("PiSessionError", error => patchState(() => announced || version !== statsVersion
        ? {} : { contextIsLastKnown: true, statsRefreshError: `Usage refresh failed: ${error.detail}` })));
    });

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
        return { ...patch, stateRefreshError: undefined };
      });
    }).pipe(Effect.catchTag("PiSessionError", error => announced || operation !== operationVersion ? Effect.void : patchState({ stateRefreshError: `Session state refresh failed: ${error.detail}` })));

    /** Replace current context, never concatenate raw history. Retry readbacks
     * raced by Pi output; bound churn and make an unresolved projection visible.
     * This is not historical replay or the phase-5 transport sequencing contract. */
    const refreshContext = Effect.gen(function* () {
      const version = ++contextVersion;
      for (let attempt = 0; attempt < 3; attempt++) {
        const outputVersion = child.observationVersion();
        const data = (yield* child.request({ type: "get_messages" })) as { messages: RawMessage[] };
        if (version !== contextVersion || announced) return;
        const applied = yield* Semaphore.withPermits(lock, 1)(Effect.gen(function* () {
          if (version !== contextVersion || outputVersion !== child.observationVersion() || announced) return false;
          yield* publish({ _tag: "context", messages: assembler.serializeMessages(data.messages) });
          return true;
        }));
        if (applied) return yield* patchState({ projectionError: undefined });
      }
      yield* patchState({ projectionError: "Pi context changed during refresh. This view may be stale until the next command or settled boundary." });
    }).pipe(Effect.catchTag("PiSessionError", error => patchState({ projectionError: `Current context refresh failed: ${error.detail}` })));

    // At most one worker per readback kind. Never await RPC inspection from the
    // record consumer: Pi may need a later dialog answered before replying.
    const refreshers = { stats: refreshStats, context: refreshContext, state: Effect.suspend(() => refreshState(operationVersion)) };
    const refreshing = new Set<keyof typeof refreshers>();
    const requested = new Set<keyof typeof refreshers>();
    const scheduleRefresh = (...kinds: Array<keyof typeof refreshers>) => Effect.gen(function* () {
      for (const kind of kinds) {
        requested.add(kind);
        if (refreshing.has(kind)) continue;
        refreshing.add(kind);
        yield* Effect.gen(function* () {
          while (requested.delete(kind) && !announced) yield* refreshers[kind];
        }).pipe(Effect.ensuring(Effect.sync(() => { refreshing.delete(kind); })), Effect.forkIn(sessionScope));
      }
    });

    const onRecord = ({ record, receivedAt }: { record: PiRecord; receivedAt: number }) =>
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
            yield* apply(() => assembler.handle(record));
            yield* patchState({ isStreaming: false, isCompacting: false, isRetrying: false });
            return yield* scheduleRefresh("context", "state", "stats");
          case "message_start":
            yield* patchState({ contextIsLastKnown: true });
            return yield* apply(() => assembler.handle(record));
          case "message_end":
            yield* patchState({ contextIsLastKnown: true });
            yield* apply(() => assembler.handle(record));
            return yield* scheduleRefresh("stats");
          case "compaction_end":
            yield* patchState({ isCompacting: false });
            // Pi reports null tokens/percent until fresh post-compaction usage exists.
            return yield* scheduleRefresh("context", "stats");
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
            if (["setStatus", "setWidget", "setTitle", "set_editor_text"].includes(method)) {
              const current = (yield* stateOf).extension ?? { statuses: [], widgets: [] };
              const extension = { ...current };
              if (method === "setStatus") extension.statuses = [
                ...current.statuses.filter(s => s.key !== record.statusKey),
                ...(typeof record.statusText === "string" ? [{ key: String(record.statusKey), text: record.statusText }] : []),
              ];
              if (method === "setWidget") extension.widgets = [
                ...current.widgets.filter(w => w.key !== record.widgetKey),
                ...(Array.isArray(record.widgetLines) ? [{ key: String(record.widgetKey), lines: record.widgetLines.map(String), placement: record.widgetPlacement === "belowEditor" ? "belowEditor" as const : "aboveEditor" as const }] : []),
              ];
              if (method === "setTitle") extension.title = String(record.title ?? "");
              if (method === "set_editor_text") extension.editorRequest = { id: `${generation}:${record.id}`, text: String(record.text ?? "") };
              yield* patchState({ extension });
              return;
            }
            if (!DIALOG_METHODS.has(method)) return;
            const id = String(record.id);
            if (seenDialogs.has(id)) return;
            seenDialogs.add(id);
            const timeoutMs = typeof record.timeout === "number" && Number.isFinite(record.timeout) && record.timeout > 0 ? record.timeout : undefined;
            const piTimeout = timeoutMs !== undefined && timeoutMs <= recoveryMs;
            const dialog: Dialog = {
              id, generation, receivedAt, timeoutMs,
              deadlineAt: receivedAt + (piTimeout ? timeoutMs : recoveryMs),
              deadlineKind: piTimeout ? "pi-timeout" : "host-recovery",
              method: method as Dialog["method"],
              title: record.title as string | undefined,
              message: record.message as string | undefined,
              options: record.options as string[] | undefined,
              placeholder: record.placeholder as string | undefined,
              prefill: record.prefill as string | undefined,
            };
            const closed = yield* Deferred.make<void>();
            dialogClosed.set(id, closed);
            yield* apply([{ _tag: "dialog", dialog }]);
            const abort = aborting;
            // Never stop stdout consumption while an extension or a pipe is blocked.
            yield* Effect.gen(function* () {
              if (abort) yield* Deferred.await(abort.dispatched);
              else yield* Effect.sleep(Math.max(0, dialog.deadlineAt - (yield* Clock.currentTimeMillis))).pipe(Effect.raceFirst(Deferred.await(closed)));
              yield* resolveDialog(dialog, abort ? "aborted" : piTimeout ? "expired" : "recovery");
            }).pipe(Effect.ignore, Effect.forkIn(sessionScope));
            return;
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
            return yield* apply(() => assembler.handle(record));
        }
      });

    const recordsDrained = yield* Deferred.make<void>();
    yield* Stream.fromQueue(child.records).pipe(
      Stream.runForEach(item => onRecord(item).pipe(Effect.ensuring(Effect.sync(() => { processedVersion++; })))), Effect.ignore,
      Effect.ensuring(Deferred.succeed(recordsDrained, undefined)), Effect.forkScoped,
    );

    // Subscribers learn exactly once that Pi is gone: from the child's own exit (a crash),
    // or from this scope closing (a deliberate release), whichever comes first. The
    // finalizer is registered after the child's, so it runs before Pi is shut down.
    const announceClosed = (closure: Effect.Effect<SessionClosure>) =>
      Effect.suspend(() => {
        if (announced) return Effect.void;
        announced = true;
        return Effect.gen(function* () {
          const final = yield* closure;
          const submission = (yield* stateOf).submission;
          if (submission?.outcome === "submitting") yield* apply([{ _tag: "submission", submission: { ...submission, outcome: "uncertain", detail: `Pi stopped before acknowledging this input: ${final.detail}` } }]);
          for (const dialog of yield* dialogsOf) yield* resolveDialog(dialog, "exited").pipe(Effect.ignore);
          const resolution = (yield* stateOf).dialogResolution;
          if (resolution?.delivery === "pending") yield* patchState({ dialogResolution: { ...resolution, delivery: "uncertain", detail: "Pi stopped during response delivery. Do not resend this dialog response." } });
          yield* apply(() => [...assembler.handle({ type: "piano_closed" }), { _tag: "closed", closure: final }]);
        });
      });
    // Release is "during work" when Pi still held work it could continue or that awaited an
    // answer. Readback workers and prompt fibers are already interrupted by now, so judge from
    // retained state and transport uncertainty, never from those fibers.
    yield* Effect.addFinalizer(() => announceClosed(Effect.map(Ref.get(snapshotRef), (snapshot): SessionClosure =>
      settled(snapshot) && !child.hasPendingWork()
        ? { _tag: "released", detail: "Pi was released" }
        : { _tag: "released_during_work", detail: "Pi was released during work" })));
    // Preserve already-read output before announcing an exit. The record-loop
    // finalizer only signals completion; it never waits for a later child finalizer.
    yield* Deferred.await(child.exited).pipe(
      Effect.flatMap((closure) => Deferred.await(recordsDrained).pipe(Effect.andThen(announceClosed(Effect.succeed(closure))))),
      Effect.forkScoped,
    );

    const currentState = Effect.gen(function* () {
      const snapshot = yield* Ref.get(snapshotRef);
      return { ...snapshot.state, isQuiescent: !announced && !child.hasPendingWork() && processedVersion === child.observationVersion() &&
        refreshing.size === 0 && promptOperations.size === 0 && settled(snapshot) };
    });

    const events: Stream.Stream<SessionFrame, DeliveryOverflow> = Stream.unwrap(
      Semaphore.withPermits(lock, 1)(
        Effect.gen(function* () {
          const sub = yield* makeDelivery<SessionFrame>();
          subscribers.add(sub);
          const snapshot: Snapshot = { ...yield* Ref.get(snapshotRef), state: yield* currentState };
          return Stream.make<[SessionFrame]>({ _tag: "snapshot", snapshot: projectDisplay(snapshot), cursor: cursor() }).pipe(
            Stream.concat(snapshot.state.closure ? Stream.empty : sub.stream),
            Stream.takeUntil((e) => e._tag === "closed"),
            Stream.ensuring(Effect.sync(() => { subscribers.delete(sub); })),
          );
        }),
      ),
    );

    let stopping = false;
    const act = (action: SessionAction): Effect.Effect<SessionActionResult | undefined, PiSessionError> =>
      Effect.gen(function* () {
        if (announced) return yield* new PiSessionError({ reason: "exited", detail: "Pi has stopped. Reopen history before sending new input; interrupted operations do not resume." });
        // Answer/abort/queue restoration do not supersede the command whose
        // dialog they unblock. Keep its subsequent model/effort readback valid.
        const operation = action._tag === "prompt" || action._tag === "steer" || action._tag === "set_model" || action._tag === "set_thinking_level" || action._tag === "set_name"
          ? ++operationVersion : operationVersion;
        switch (action._tag) {
          case "commands":
            return { _tag: "commands", commands: yield* child.request({ type: "get_commands" }).pipe(Effect.flatMap(commandsOf)) };
          case "prompt":
          case "steer": {
            if (action.attachments?.length) {
              if (!Schema.is(Attachments)(action.attachments) || action.attachments.some(a => {
                const bytes = Buffer.from(a.data, "base64");
                return bytes.toString("base64") !== a.data || imageType(bytes) !== a.mimeType;
              })) return yield* new PiSessionError({ reason: "rejected", detail: "Invalid image attachments. Use PNG, JPEG, GIF or WebP, up to 10 MiB each and 20 MiB total (4 images)." });
              // Pi's clear_queue only returns text. Do not offer a lossy image queue.
              if (isWorking(yield* stateOf)) return yield* new PiSessionError({ reason: "rejected", detail: "Wait for Pi to finish before sending images." });
            }
            // Explicit new input starts a new operation boundary. An older abort's
            // acknowledgement must never cancel its dialogs or clear its activity.
            aborting = undefined;
            promptOperations.add(operation);
            const id = ++submissionId;
            const submit = (outcome: PromptSubmission["outcome"], detail?: string) => apply([{ _tag: "submission", submission: { id, outcome, detail } }]);
            // Once dispatched, acknowledgement tracking belongs to the session,
            // not the browser/caller that may disconnect while Pi handles input.
            const work = Effect.gen(function* () {
              yield* submit("submitting");
              yield* child.request({ type: "prompt", message: action.text, images: action.attachments?.map(a => ({ type: "image", data: a.data, mimeType: a.mimeType })), streamingBehavior: action.attachments?.length ? undefined : action._tag === "steer" ? "steer" : "followUp" }).pipe(
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
              // Handled commands may edit context without a run/compaction event.
              if (!(yield* stateOf).isStreaming) {
                yield* refreshContext;
                yield* scheduleRefresh("stats");
              }
            });
            yield* work.pipe(Effect.ensuring(endAbortingPrompt(operation)), Effect.forkIn(sessionScope), Effect.flatMap(Fiber.join));
            return;
          }
          case "abort": {
            const work = Effect.gen(function* () {
              const dispatched = yield* Deferred.make<void>();
              const current = { dispatched, pendingPrompts: new Set(promptOperations), acknowledged: false };
              aborting = current;
              const dialogs = yield* dialogsOf;
              const native = yield* child.request({ type: "abort" }, dispatched).pipe(Effect.forkChild);
              // Order abort before releasing an extension that may continue work.
              // This waits for the transport attempt, NOT Pi's acknowledgement.
              yield* Deferred.await(dispatched);
              // Cancellation must not wait for native abort's acknowledgement:
              // idle extension commands often have no signal for it to cancel.
              for (const dialog of dialogs) {
                yield* resolveDialog(dialog, "aborted").pipe(Effect.ignore);
              }
              yield* Fiber.join(native).pipe(Effect.ensuring(Effect.sync(() => {
                if (aborting !== current) return;
                current.acknowledged = true;
                if (current.pendingPrompts.size === 0) aborting = undefined;
              })));
            });
            yield* work.pipe(Effect.forkIn(sessionScope), Effect.flatMap(Fiber.join));
            return;
          }
          case "stop": {
            stopping = true;
            // Pi has no compound RPC. Take its authoritative queue before abort
            // can drain steering at a tool boundary (INV-01/03). Keep ownership
            // in the session if the requesting browser disconnects mid-operation.
            const work = Effect.gen(function* () {
              yield* patchState({ isStopping: true });
              const restored = yield* act({ _tag: "restore_queue" });
              if (restored?._tag !== "queue_restored") return yield* new PiSessionError({ reason: "protocol", detail: "Pi did not return the cleared queue." });
              const stopError = yield* act({ _tag: "abort" }).pipe(
                Effect.as(undefined),
                Effect.catchTag("PiSessionError", error => Effect.succeed(`Queued input was taken back, but Stop failed: ${error.detail}`)),
              );
              // Return partial failure with the text: session events may already
              // have ended at `closed`, so a notice there could be lost.
              return stopError ? { ...restored, stopError } : restored;
            }).pipe(Effect.ensuring(Effect.gen(function* () {
              stopping = false;
              yield* patchState({ isStopping: false });
            })));
            return yield* work.pipe(Effect.forkIn(sessionScope), Effect.flatMap(Fiber.join));
          }
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
          case "set_name": {
            const name = action.name.replace(/[\r\n]+/g, " ").trim();
            if (!name) return yield* new PiSessionError({ reason: "rejected", detail: "A session name cannot be empty." });
            yield* child.request({ type: "set_session_name", name });
            yield* refreshState(operation);
            return;
          }
          case "answer": {
            const work = Effect.gen(function* () {
              const dialog = (yield* dialogsOf).find(open => open.id === action.id);
              if (!dialog || action.generation !== generation) return yield* new PiSessionError({ reason: "rejected", detail: "Dialog is no longer open in this Pi process. Refresh the session; do not resend the answer." });
              let value = action.value ?? "";
              if (dialog.method === "select" && !action.cancelled) {
                // Keep protocol values private. Redacted labels must not change
                // what Pi receives, nor silently choose between colliding labels.
                const options = dialog.options?.filter(option => projectDisplay(option) === value) ?? [];
                if (options.length !== 1) return yield* new PiSessionError({ reason: "rejected", detail: "This option is unavailable or ambiguous after redaction. Cancel the dialog instead." });
                value = options[0];
              }
              const response = action.confirmed !== undefined ? { confirmed: action.confirmed } : { value };
              const resolution = yield* resolveDialog(dialog, action.cancelled ? "cancelled" : "answered", response);
              if (!resolution || resolution.reason === "expired" || resolution.reason === "recovery") return yield* new PiSessionError({ reason: "rejected", detail: "Dialog was already claimed or its host deadline elapsed. The answer was not sent." });
            });
            yield* work.pipe(Effect.forkIn(sessionScope), Effect.flatMap(Fiber.join));
            return;
          }
        }
      });

    // Cached values must be available without waiting for a slow/failed readback.
    // Uncached sessions retain the initial statistics readiness contract.
    if (spec.lastKnownStats) yield* scheduleRefresh("stats");
    else yield* refreshStats;
    const session: PiSession = { spec, events,
      act: action => Effect.suspend(() => {
        // Reject rather than delay input: delayed submissions could accidentally
        // start new work as soon as Stop completes. Answers must remain available.
        if (stopping && ["prompt", "steer", "stop", "abort", "restore_queue"].includes(action._tag)) {
          return Effect.fail(new PiSessionError({ reason: "rejected", detail: "Stop is in progress. Wait before sending input or changing the queue." }));
        }
        return act(action);
      }).pipe(Effect.map(projectDisplay), Effect.mapError(error => new PiSessionError({ reason: error.reason, detail: projectDisplay(error.detail) }))),
      state: Semaphore.withPermits(lock, 1)(currentState).pipe(Effect.map(projectDisplay)),
    };
    return session;
  });

const probe = (cwd: string, options?: { globalSettingsOnly?: boolean }): Effect.Effect<ProbeResult, PiSessionError, ChildProcessSpawner> =>
  Effect.gen(function* () {
    const child = yield* spawnChild(["--no-session", ...(options?.globalSettingsOnly ? ["--no-approve"] : [])], cwd);
    const [models, state, commands] = yield* Effect.all([
      child.request({ type: "get_available_models" }),
      child.request({ type: "get_state" }),
      child.request({ type: "get_commands" }).pipe(Effect.flatMap(commandsOf)),
    ]).pipe(
      Effect.raceFirst(
        Deferred.await(child.exited).pipe(
          Effect.flatMap((closure) => new PiSessionError({ reason: "spawn", detail: closure.detail })),
        ),
      ),
    );
    const raw = state as RawState;
    return {
      commands,
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
      probe: (cwd, options) => probe(cwd, options).pipe(Effect.provideService(ChildProcessSpawner, spawner)),
    });
  }),
);
