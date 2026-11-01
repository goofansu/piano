/** Internal to PiSessions: one scoped child, bounded byte framing/queues, request
 * correlation and delivery uncertainty. Owns terminal failure and process cleanup.
 * It never publishes browser state or decides dialog/action semantics. */
import {
  Cause,
  Clock,
  Context,
  Data,
  Deferred,
  Effect,
  Fiber,
  Queue,
  Schema,
  Stream,
} from "effect";
import { ChildProcess } from "effect/process";
import type { LaunchEnv } from "../shared/dispatch.ts";
import type { SessionClosure } from "../shared/wire.ts";
import { childEnvironment } from "./ChildEnvironment.ts";
import { projectDisplay } from "./DisplayProjection.ts";
import { inboundLimits, makeInboundCapacity } from "./InboundCapacity.ts";
import { PiCli } from "./PiCli.ts";
import type { PiExchange, PiReadback, PiRecord } from "./PiRecords.ts";

export class PiSessionError extends Data.TaggedError("PiSessionError")<{
  readonly reason: "spawn" | "exited" | "protocol" | "rejected" | "timeout" | "transport";
  readonly detail: string;
  /** Refused before Pi saw the action (a closing host, a missing checkout, Stop in progress, full
   * input capacity, an exited Pi): never delivered. Build it with `refusedUnsent`. */
  readonly notSent?: true;
}> {}

/** A refusal before Pi saw the action, so its sender may take the input back. */
export const refusedUnsent = (reason: PiSessionError["reason"], detail: string) =>
  new PiSessionError({ reason, detail, notSent: true });

/** Host acknowledgement deadline, not a deadline for model work or extension execution. */
export const PiRequestTimeoutMs = Context.Reference<number>("piano/PiRequestTimeoutMs", {
  defaultValue: () => 30_000,
});

const encoder = new TextEncoder();

// Validate only the envelope; PiRecords owns payload interpretation. Unknown
// event types and extra fields remain forward compatible, not malformed input.
const validEnvelope = Schema.is(
  Schema.Struct({ type: Schema.NonEmptyString, id: Schema.optional(Schema.String) }),
);
const validResponse = Schema.is(
  Schema.Struct({
    type: Schema.Literal("response"),
    id: Schema.optional(Schema.String),
    command: Schema.String,
    success: Schema.Boolean,
    data: Schema.optional(Schema.Unknown),
    error: Schema.optional(Schema.String),
  }),
);

/** The inbound capacity a command occupies. "control" is the reserved lane ordinary work cannot
 * fill; the caller chooses it (PiSessions, from its action policy), never a command's name. */
export type PiLane = "control" | "ordinary";

/** A spawned Pi child with request correlation. Everything above builds on `request` and `records`. */
export interface PiTransport {
  /** An exchange's command, which may change Pi, its reply decoded; a reply of the wrong shape
   * fails as "protocol". One whose delivery becomes uncertain leaves pending work. */
  readonly request: <A>(
    exchange: PiExchange<A>,
    options: { readonly lane: PiLane; readonly dispatched?: Deferred.Deferred<void> },
  ) => Effect.Effect<A, PiSessionError>;
  /** A readback's query, its reply decoded; a reply of the wrong shape fails as "protocol".
   * Ordinary lane; a query changes nothing, so its timeout leaves no pending work. */
  readonly read: <A>(readback: PiReadback<A>) => Effect.Effect<A, PiSessionError>;
  /** A record Pi sends no response to, such as a dialog answer. */
  readonly write: (
    record: Record<string, unknown>,
    options: { readonly lane: PiLane },
  ) => Effect.Effect<void, PiSessionError>;
  /** Every accepted non-response record, in stdout order. Ends after stdout drains or fails. */
  readonly records: Stream.Stream<{ record: PiRecord; receivedAt: number }>;
  readonly exited: Deferred.Deferred<SessionClosure>;
  /** Stop an unusable session and settle all transport work before killing Pi. */
  readonly fail: (detail: string) => Effect.Effect<void>;
  /** Includes queued records, so readbacks cannot race output not yet projected. */
  readonly observationVersion: () => number;
  readonly hasPendingWork: () => boolean;
}

const debug = (...a: unknown[]) => {
  if (process.env.PIANO_DEBUG) console.error("[PiTransport]", ...projectDisplay(a));
};

const spawn = Effect.fn("PiTransport.spawn")(function* (
  args: ReadonlyArray<string>,
  cwd: string,
  lifetime?: { env: LaunchEnv; onExit: () => void },
) {
  const cli = yield* PiCli;
  const timeoutMs = yield* PiRequestTimeoutMs;
  debug("spawning", cli.node, cli.cli, args);
  const stdin = yield* Queue.dropping<
    { bytes: Uint8Array; done: Deferred.Deferred<void, PiSessionError> },
    Cause.Done
  >(inboundLimits.writes.messages + inboundLimits.control.messages);
  const records = yield* Queue.dropping<
    { record: PiRecord; receivedAt: number; bytes: number },
    Cause.Done
  >(inboundLimits.records.messages);
  let recordBytes = 0;
  const requestCapacity = makeInboundCapacity(inboundLimits.requests);
  const writeCapacity = makeInboundCapacity(inboundLimits.writes);
  const writes = new Map<Deferred.Deferred<void, PiSessionError>, () => void>();
  let transportError: PiSessionError | undefined;
  const pending = new Map<string, Deferred.Deferred<unknown, PiSessionError>>();
  // OS exit stops input, but is not the end of already-produced RPC output.
  const processExited = yield* Deferred.make<void>();
  const stdoutDrained = yield* Deferred.make<void>();
  const exited = yield* Deferred.make<SessionClosure>();
  let inputClosure: SessionClosure | undefined;
  let stderr = "";
  let closed = false;
  let seq = 0;
  let observationVersion = 0;
  let uncertainMutation = false;
  let uncertainWrite = false;

  const handle = yield* ChildProcess.make(
    cli.node,
    [
      cli.cli,
      "--mode",
      "rpc",
      // Before the session arguments, so a `-e` in PIANO_PI_ARGS adds to Piano's own extensions
      // rather than being shadowed by them.
      ...(cli.extensions ?? []).flatMap((path) => ["--extension", path]),
      ...(cli.promptTemplates ?? []).flatMap((path) => ["--prompt-template", path]),
      ...(cli.skills ?? []).flatMap((path) => ["--skill", path]),
      ...args,
      ...cli.extraArgs,
    ],
    {
      cwd,
      // Development only: `npm run dev` (node --watch) sets WATCH_REPORT_DEPENDENCIES=1, and Pi's
      // image-resize worker then mistakes Node's dependency-watch message for its result and
      // reports a bogus size-limit omission. `npm start` and the hosted service never set it (INV-12).
      // `cli.env` carries this instance's session endpoint (SessionEndpoint), `lifetime.env` this
      // session's own values; no other launch variable reaches Pi (ChildEnvironment).
      env: {
        ...childEnvironment(),
        WATCH_REPORT_DEPENDENCIES: undefined,
        ...cli.env,
        ...lifetime?.env,
      },
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      forceKillAfter: "1 second",
    },
  ).pipe(Effect.mapError((e) => new PiSessionError({ reason: "spawn", detail: String(e) })));
  debug("spawned pid", handle.pid);

  const onLine = Effect.fnUntraced(function* (line: string) {
    if (closed) return;
    const record: unknown = yield* Effect.try({
      try: () => JSON.parse(line),
      catch: () =>
        new PiSessionError({
          reason: "protocol",
          detail: "Pi protocol failure: malformed JSON on stdout.",
        }),
    });
    if (!validEnvelope(record) || (record.type === "response" && !validResponse(record))) {
      return yield* new PiSessionError({
        reason: "protocol",
        detail: "Pi protocol failure: invalid RPC envelope on stdout.",
      });
    }
    debug("record", record.type); // Never log unprojected protocol content.
    if (record.type === "response") {
      // Late/unmatched acknowledgements must not become session activity.
      if (typeof record.id !== "string" || !pending.has(record.id)) return;
      const d = pending.get(record.id) as Deferred.Deferred<unknown, PiSessionError>;
      pending.delete(record.id);
      if (validResponse(record)) {
        if (record.success) yield* Deferred.succeed(d, record.data);
        else
          yield* Deferred.fail(
            d,
            new PiSessionError({ reason: "rejected", detail: record.error ?? record.command }),
          );
      }
      return;
    }
    const bytes = Buffer.byteLength(line);
    if (
      recordBytes + bytes > inboundLimits.records.bytes ||
      !Queue.offerUnsafe(records, { record, receivedAt: yield* Clock.currentTimeMillis, bytes })
    ) {
      return yield* new PiSessionError({
        reason: "protocol",
        detail:
          "Pi output exceeded the pending record limit. Reopen history before continuing; do not automatically resend input.",
      });
    }
    recordBytes += bytes;
    observationVersion += 1;
  });

  yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        stderr = (stderr + chunk).slice(-8192);
      }),
    ),
    // Diagnostic-only stream: losing stderr does not invalidate RPC stdout.
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : Effect.logWarning("Pi stderr reader failed; exit diagnostics may be incomplete."),
    ),
    Effect.forkScoped,
  );

  const stopInput = Effect.fn("PiTransport.stopInput")(function* (closure: SessionClosure) {
    if (inputClosure) return;
    inputClosure = closure;
    lifetime?.onExit();
    // Discard queued writes, not accepted stdout. Never replay an uncertain write.
    yield* Queue.shutdown(stdin);
    for (const [done, release] of writes) {
      release();
      yield* Deferred.fail(done, new PiSessionError({ reason: "exited", detail: closure.detail }));
    }
    writes.clear();
  });

  const finish = Effect.fn("PiTransport.finish")(function* (closure: SessionClosure) {
    if (closed) return;
    closed = true;
    yield* stopInput(closure);
    yield* Deferred.succeed(exited, closure);
    for (const d of pending.values()) {
      yield* Deferred.fail(d, new PiSessionError({ reason: "exited", detail: closure.detail }));
    }
    pending.clear();
    // Queue.end preserves accepted records; PiSessions projects them before closure.
    yield* Queue.end(records);
  });

  const failOutput = Effect.fn("PiTransport.failOutput")(function* (detail: string) {
    if (closed) return;
    // Settle callers and publish failure before waiting for process termination.
    // Never include raw protocol content (which may contain secrets) in diagnostics.
    yield* finish({ _tag: "failed", detail });
    yield* Queue.end(stdin);
    yield* handle.kill({ forceKillAfter: "1 second" }).pipe(Effect.ignore);
  });

  // Frame bytes before decoding or parsing. A newline-free producer cannot grow
  // splitLines' internal string without bound; multibyte UTF-8 may span chunks.
  let partial = Buffer.alloc(0),
    partialLength = 0;
  const onChunk = Effect.fnUntraced(function* (chunk: Uint8Array) {
    let start = 0;
    for (let end = 0; end <= chunk.length; end++) {
      if (end < chunk.length && chunk[end] !== 10) continue;
      const length = partialLength + end - start;
      if (length > inboundLimits.rpcLineBytes)
        return yield* new PiSessionError({
          reason: "protocol",
          detail:
            "Pi stdout exceeded the RPC line byte limit. Reopen history before continuing; do not automatically resend input.",
        });
      if (partial.length < length) {
        const next = Buffer.allocUnsafe(
          Math.min(inboundLimits.rpcLineBytes, Math.max(length, partial.length * 2, 65536)),
        );
        partial.copy(next, 0, 0, partialLength);
        partial = next;
      }
      partial.set(chunk.subarray(start, end), partialLength);
      partialLength = length;
      if (end < chunk.length) {
        yield* onLine(partial.toString("utf8", 0, partialLength));
        partialLength = 0;
      }
      start = end + 1;
    }
  });
  const stdoutReader = yield* handle.stdout
    .pipe(
      Stream.runForEach(onChunk),
      Effect.andThen(
        Effect.suspend(() =>
          partialLength ? onLine(partial.toString("utf8", 0, partialLength)) : Effect.void,
        ),
      ),
    )
    .pipe(
      Effect.andThen(Deferred.succeed(stdoutDrained, undefined)),
      // Normal EOF usually precedes exitCode notification. A child that closes
      // stdout but stays alive cannot acknowledge further commands.
      Effect.andThen(
        Deferred.await(processExited).pipe(
          Effect.timeoutOption("1 second"),
          Effect.flatMap((result) =>
            result._tag === "None"
              ? failOutput("Pi stdout closed while the process was still running.")
              : Effect.void,
          ),
        ),
      ),
      Effect.catchTag("PiSessionError", (error) => failOutput(error.detail)),
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.void
          : failOutput(
              "Pi stdout reader failed: malformed RPC output or unreadable transport. Reopen history before continuing; do not automatically resend input.",
            ),
      ),
      Effect.forkScoped,
    );

  yield* handle.exitCode.pipe(
    Effect.flatMap((code) =>
      Effect.gen(function* () {
        const closure: SessionClosure = {
          _tag: "exited",
          code,
          detail: `Pi exited with code ${code}${stderr.trim() ? `: ${stderr.trim().slice(-500)}` : ""}`,
        };
        yield* stopInput(closure);
        yield* Deferred.succeed(processExited, undefined);
        // A descendant may retain stdout indefinitely. Give already-produced
        // output a bounded drain, including response correlation and framing.
        const drained = yield* Deferred.await(stdoutDrained).pipe(Effect.timeoutOption("1 second"));
        if (drained._tag === "None") {
          yield* failOutput(
            "Pi stdout drain timed out after process exit; final output or acknowledgements may be missing. Reopen history before continuing; do not automatically resend input.",
          );
          yield* Fiber.interrupt(stdoutReader);
        } else yield* finish(closure);
      }),
    ),
    Effect.catchCause((cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.void
        : failOutput(
            "Pi exit could not be observed. Reopen history before continuing; do not automatically resend input.",
          ),
    ),
    Effect.forkScoped,
  );

  // Acknowledge a write only after the sink has pulled its bytes and accepted
  // them with backpressure. This still cannot prove Pi consumed a UI response.
  yield* Stream.fromQueue(stdin).pipe(
    Stream.flatMap(({ bytes, done }) =>
      Stream.make(bytes).pipe(
        Stream.concat(
          Stream.fromEffect(
            Effect.sync(() => {
              writes.get(done)?.();
              writes.delete(done);
            }).pipe(Effect.andThen(Deferred.succeed(done, undefined))),
          ).pipe(Stream.drain),
        ),
      ),
    ),
    Stream.run(handle.stdin),
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        if (Cause.hasInterruptsOnly(cause) || closed) return;
        transportError = new PiSessionError({
          reason: "transport",
          detail:
            "Pi stdin failed; delivery is uncertain. Reopen history before continuing; do not automatically resend input.",
        });
        for (const [done, release] of writes) {
          release();
          yield* Deferred.fail(done, transportError);
        }
        writes.clear();
        // Preserve pending response correlation: a failed write does not erase
        // acknowledgements for earlier commands still draining from stdout.
        // Only a child that keeps running with unusable stdin is a transport failure.
        const exit = yield* Deferred.await(processExited).pipe(Effect.timeoutOption("1 second"));
        if (exit._tag === "None") yield* failOutput(transportError.detail);
      }),
    ),
    Effect.forkScoped,
  );

  // Orderly shutdown: close stdin, give Pi a moment, then kill.
  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      lifetime?.onExit();
      if (closed) return;
      yield* Queue.end(stdin);
      const done = yield* Deferred.await(exited).pipe(Effect.timeoutOption("3 seconds"));
      if (done._tag === "None")
        yield* handle.kill({ forceKillAfter: "1 second" }).pipe(Effect.ignore);
    }),
  );

  const write = Effect.fn("PiTransport.write")(function* (
    record: Record<string, unknown>,
    options: { readonly lane: PiLane },
  ) {
    if (inputClosure)
      return yield* new PiSessionError({
        reason: "exited",
        detail: inputClosure.detail,
      });
    if (transportError) return yield* transportError;
    const text = `${JSON.stringify(record)}\n`;
    const size = Buffer.byteLength(text);
    if (size > inboundLimits.rpcLineBytes)
      return yield* new PiSessionError({
        reason: "rejected",
        detail: "Input exceeds the Pi RPC byte limit. Nothing was sent.",
      });
    const done = yield* Deferred.make<void, PiSessionError>();
    const release = writeCapacity.acquire(size, options.lane === "control");
    if (!release)
      return yield* refusedUnsent(
        "rejected",
        "Pi input capacity is full. Nothing was sent; wait for pending work before trying again.",
      );
    writes.set(done, release);
    if (!Queue.offerUnsafe(stdin, { bytes: encoder.encode(text), done })) {
      release();
      writes.delete(done);
      return yield* new PiSessionError({
        reason: "rejected",
        detail: "Pi input queue is closed or full. Nothing was sent.",
      });
    }
    yield* Deferred.await(done).pipe(
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () =>
          Effect.fail(
            new PiSessionError({
              reason: "transport",
              detail:
                "Pi stdin write timed out; delivery is uncertain. Do not resend this response.",
            }),
          ),
      }),
      Effect.tapError(() =>
        Effect.sync(() => {
          uncertainWrite = true;
        }),
      ),
      // Queued bytes keep their capacity lease after caller timeout/interruption
      // until the sink accepts them or the transport closes (delivery is uncertain).
    );
  });

  const send = Effect.fn("PiTransport.request")(function* (
    command: Record<string, unknown>,
    {
      lane,
      dispatched,
      readback,
    }: { lane: PiLane; dispatched?: Deferred.Deferred<void>; readback: boolean },
  ) {
    const size = Buffer.byteLength(JSON.stringify(command));
    const d = yield* Deferred.make<unknown, PiSessionError>();
    const release = requestCapacity.acquire(size, lane === "control");
    if (!release) {
      if (dispatched) yield* Deferred.succeed(dispatched, undefined);
      return yield* refusedUnsent(
        "rejected",
        "Pi command capacity is full. Nothing was sent; wait for pending work before trying again.",
      );
    }
    seq += 1;
    const id = `q${seq}`;
    pending.set(id, d);
    debug("request", id, command.type);
    return yield* write({ id, ...command }, { lane }).pipe(
      Effect.ensuring(dispatched ? Deferred.succeed(dispatched, undefined) : Effect.void),
      Effect.andThen(Deferred.await(d)),
      Effect.timeoutOrElse({
        duration: timeoutMs,
        orElse: () =>
          Effect.fail(
            new PiSessionError({
              reason: "timeout",
              detail: `Pi did not acknowledge ${command.type} within ${timeoutMs}ms. Delivery may have occurred; inspect the session before sending again.`,
            }),
          ),
      }),
      Effect.tapError((error) =>
        Effect.sync(() => {
          // Timeout is not cancellation. A newer successful command cannot
          // establish that an older, unacknowledged mutation stopped running.
          if (!readback && error.reason !== "rejected") uncertainMutation = true;
        }),
      ),
      Effect.ensuring(
        Effect.sync(() => {
          pending.delete(id);
          release();
        }),
      ),
    );
  });

  // Decoded after `send`: a reply of the wrong shape still proves delivery, so it marks no
  // uncertain mutation.
  const exchange = Effect.fnUntraced(function* <A>(
    { command, decode, invalid }: PiExchange<A>,
    options: { lane: PiLane; dispatched?: Deferred.Deferred<void>; readback: boolean },
  ) {
    const value = decode(yield* send(command, options));
    if (value === undefined)
      return yield* new PiSessionError({ reason: "protocol", detail: invalid });
    return value;
  });

  const request: PiTransport["request"] = (command, options) =>
    exchange(command, { ...options, readback: false });

  const read = Effect.fn("PiTransport.read")(function* <A>(readback: PiReadback<A>) {
    return yield* exchange(readback, { lane: "ordinary", readback: true });
  });

  const recordStream = Stream.fromEffectRepeat(Queue.take(records)).pipe(
    Stream.map((item) => {
      recordBytes -= item.bytes;
      return item;
    }),
  );
  const child: PiTransport = {
    request,
    read,
    write,
    records: recordStream,
    exited,
    fail: failOutput,
    observationVersion: () => observationVersion,
    hasPendingWork: () =>
      pending.size > 0 || writes.size > 0 || uncertainMutation || uncertainWrite,
  };
  return child;
});

export const PiTransport = { spawn };
