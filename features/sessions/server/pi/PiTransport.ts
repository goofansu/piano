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
import { childEnvironment } from "../../../../server/shared/ChildEnvironment.ts";
import { projectDisplay } from "../../../../server/shared/DisplayProjection.ts";
import { inboundLimits, makeInboundCapacity } from "../../../../server/shared/InboundCapacity.ts";
import { inputBytes } from "../../../../server/shared/InputBytes.ts";
import type { LaunchEnv } from "../../../../shared/session/dispatch.ts";
import type { SessionClosure } from "../../../../shared/wire.ts";
import { makePendingRecords } from "./PendingRecords.ts";
import { PiCli } from "./PiCli.ts";
import type { PiExchange, PiReadback, PiRecord } from "./PiRecords.ts";

export class PiSessionError extends Data.TaggedError("PiSessionError")<{
  readonly reason: "spawn" | "exited" | "protocol" | "rejected" | "timeout" | "transport";
  readonly detail: string;
  readonly notSent?: true;
  readonly startupStopped?: true;
}> {}

export const refusedUnsent = (reason: PiSessionError["reason"], detail: string) =>
  new PiSessionError({ reason, detail, notSent: true });

export const PiRequestTimeoutMs = Context.Reference<number>("piano/PiRequestTimeoutMs", {
  defaultValue: () => 30_000,
});

const MiB = 1024 * 1024;
const RETAINED_STDOUT_BYTES = MiB;
const LARGE_STDOUT_REUSE_MS = 1000;
const PI_INPUT_MS_PER_MIB = 1000;
const deliveryDeadline = (base: number, bytes: number) =>
  base + Math.floor(bytes / MiB) * PI_INPUT_MS_PER_MIB;

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

export type PiLane = "control" | "ordinary";

export interface PiTransport {
  readonly request: <A>(
    exchange: PiExchange<A>,
    options: { readonly lane: PiLane; readonly dispatched?: Deferred.Deferred<void> },
  ) => Effect.Effect<A, PiSessionError>;
  readonly read: <A>(readback: PiReadback<A>) => Effect.Effect<A, PiSessionError>;
  readonly write: (
    record: Record<string, unknown>,
    options: { readonly lane: PiLane },
  ) => Effect.Effect<void, PiSessionError>;
  readonly records: Stream.Stream<{ record: PiRecord; receivedAt: number }>;
  readonly exited: Deferred.Deferred<SessionClosure>;
  readonly stopped: Effect.Effect<boolean>;
  readonly fail: (detail: string) => Effect.Effect<void>;
  readonly observationVersion: () => number;
  readonly hasPendingWork: () => boolean;
}

const debug = (...a: unknown[]) => {
  if (process.env.PIANO_DEBUG) console.error("[PiTransport]", Date.now(), ...projectDisplay(a));
};

const spawn = Effect.fn("PiTransport.spawn")(function* (
  args: ReadonlyArray<string>,
  cwd: string,
  lifetime?: { env: LaunchEnv },
) {
  const cli = yield* PiCli;
  const timeoutMs = yield* PiRequestTimeoutMs;
  debug("spawning", cli.node, cli.cli, args);
  const stdin = yield* Queue.dropping<
    { bytes: Uint8Array; done: Deferred.Deferred<void, PiSessionError> },
    Cause.Done
  >(inboundLimits.writes.messages + inboundLimits.control.messages);
  const records = yield* makePendingRecords<{ record: PiRecord; receivedAt: number }>(
    inboundLimits.records,
  );
  const requestCapacity = makeInboundCapacity(inboundLimits.requests);
  const writeCapacity = makeInboundCapacity(inboundLimits.writes);
  const writes = new Map<Deferred.Deferred<void, PiSessionError>, () => void>();
  let transportError: PiSessionError | undefined;
  const pending = new Map<string, Deferred.Deferred<unknown, PiSessionError>>();
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
      ...(cli.extensions ?? []).flatMap((path) => ["--extension", path]),
      ...(cli.promptTemplates ?? []).flatMap((path) => ["--prompt-template", path]),
      ...(cli.skills ?? []).flatMap((path) => ["--skill", path]),
      ...args,
      ...cli.extraArgs,
    ],
    {
      cwd,
      // Node --watch messages confuse Pi's image-resize worker; clear WATCH_REPORT_DEPENDENCIES.
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

  const onLine = Effect.fnUntraced(function* (line: string, bytes: number) {
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
    debug(
      "record",
      record.type,
      record.type === "response" && "command" in record ? record.command : "",
    );
    if (record.type === "response") {
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
    const item = { record, receivedAt: yield* Clock.currentTimeMillis };
    const admitted = yield* records.offer(item, bytes).pipe(
      Effect.mapError(
        ({ limit }) =>
          new PiSessionError({
            reason: "protocol",
            detail: `Pi output exceeded the pending record limit of ${
              limit === "bytes"
                ? `${inboundLimits.records.bytes / MiB} MiB`
                : `${inboundLimits.records.messages} records`
            }. Reopen history before continuing; do not automatically resend input.`,
          }),
      ),
    );
    if (admitted) observationVersion += 1;
  });

  yield* handle.stderr.pipe(
    Stream.decodeText(),
    Stream.runForEach((chunk) =>
      Effect.sync(() => {
        stderr = (stderr + chunk).slice(-8192);
      }),
    ),
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
    yield* records.end;
  });

  const failOutput = Effect.fn("PiTransport.failOutput")(function* (detail: string) {
    if (closed) return;
    yield* finish({ _tag: "failed", detail });
    yield* Queue.end(stdin);
    yield* handle.kill({ forceKillAfter: "1 second" }).pipe(Effect.ignore);
  });

  let partial = Buffer.alloc(0),
    partialLength = 0;
  let partialRelease: ReturnType<typeof setTimeout> | undefined;
  const retainPartial = (lineBytes: number) => {
    if (partial.length <= RETAINED_STDOUT_BYTES) return;
    if (lineBytes <= RETAINED_STDOUT_BYTES && partialRelease) return;
    clearTimeout(partialRelease);
    partialRelease = setTimeout(() => {
      partialRelease = undefined;
      if (partialLength === 0) partial = Buffer.alloc(0);
    }, LARGE_STDOUT_REUSE_MS);
    partialRelease.unref();
  };
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
        yield* onLine(partial.toString("utf8", 0, partialLength), partialLength);
        partialLength = 0;
        retainPartial(length);
      }
      start = end + 1;
    }
  });
  const stdoutReader = yield* handle.stdout
    .pipe(
      Stream.runForEach(onChunk),
      Effect.andThen(
        Effect.suspend(() =>
          partialLength
            ? onLine(partial.toString("utf8", 0, partialLength), partialLength)
            : Effect.void,
        ),
      ),
    )
    .pipe(
      Effect.ensuring(
        Effect.sync(() => {
          clearTimeout(partialRelease);
          partialRelease = undefined;
          partial = Buffer.alloc(0);
          partialLength = 0;
        }),
      ),
      Effect.andThen(Deferred.succeed(stdoutDrained, undefined)),
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
        const exit = yield* Deferred.await(processExited).pipe(Effect.timeoutOption("1 second"));
        if (exit._tag === "None") yield* failOutput(transportError.detail);
      }),
    ),
    Effect.forkScoped,
  );

  yield* Effect.addFinalizer(() =>
    Effect.gen(function* () {
      if (closed) return;
      yield* Queue.end(stdin);
      const done = yield* Deferred.await(exited).pipe(Effect.timeoutOption("3 seconds"));
      if (done._tag === "None")
        yield* handle.kill({ forceKillAfter: "1 second" }).pipe(Effect.ignore);
    }),
  );

  const enqueue = Effect.fnUntraced(function* (
    record: Record<string, unknown>,
    options: { readonly lane: PiLane },
  ) {
    if (inputClosure) return yield* refusedUnsent("exited", inputClosure.detail);
    if (transportError) return yield* transportError;
    const text = JSON.stringify(record);
    const size = Buffer.byteLength(text) + 1;
    if (size > inboundLimits.rpcLineBytes)
      return yield* refusedUnsent(
        "rejected",
        "Input exceeds the Pi RPC byte limit. Nothing was sent.",
      );
    const done = yield* Deferred.make<void, PiSessionError>();
    const release = writeCapacity.acquire(size, options.lane === "control");
    if (!release)
      return yield* refusedUnsent(
        "rejected",
        "Pi input capacity is full. Nothing was sent; wait for pending work before trying again.",
      );
    const bytes = Buffer.allocUnsafe(size);
    bytes.write(text, 0, size - 1, "utf8");
    bytes[size - 1] = 10;
    writes.set(done, release);
    if (!Queue.offerUnsafe(stdin, { bytes, done })) {
      release();
      writes.delete(done);
      return yield* refusedUnsent(
        "rejected",
        "Pi input queue is closed or full. Nothing was sent.",
      );
    }
    return { done, size };
  });

  const write = Effect.fn("PiTransport.write")(function* (
    record: Record<string, unknown>,
    options: { readonly lane: PiLane },
  ) {
    const { done, size } = yield* enqueue(record, options);
    yield* Deferred.await(done).pipe(
      Effect.timeoutOrElse({
        duration: deliveryDeadline(timeoutMs, size),
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
    const size = inputBytes(command);
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
    const deadline = deliveryDeadline(timeoutMs, size);
    return yield* write({ id, ...command }, { lane }).pipe(
      Effect.ensuring(dispatched ? Deferred.succeed(dispatched, undefined) : Effect.void),
      Effect.andThen(Deferred.await(d)),
      Effect.timeoutOrElse({
        duration: deadline,
        orElse: () =>
          Effect.fail(
            new PiSessionError({
              reason: "timeout",
              detail: `Pi did not acknowledge ${command.type} within ${deadline}ms. Delivery may have occurred; inspect the session before sending again.`,
            }),
          ),
      }),
      Effect.tapError((error) =>
        Effect.sync(() => {
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

  const child: PiTransport = {
    request,
    read,
    write,
    records: records.items,
    exited,
    stopped: handle.exitCode.pipe(
      Effect.exit,
      Effect.timeoutOption("1 second"),
      Effect.andThen(handle.isRunning),
      Effect.map((running) => !running),
      Effect.orElseSucceed(() => false),
    ),
    fail: failOutput,
    observationVersion: () => observationVersion,
    hasPendingWork: () =>
      pending.size > 0 || writes.size > 0 || uncertainMutation || uncertainWrite,
  };
  return child;
});

export const PiTransport = { spawn };
