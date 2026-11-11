/**
 * A session creation attempt, end to end: the durable claim on its identity, the refusal of that
 * identity for different input, the outcome its creation records, and the one read-back every
 * duplicate, reconnect and unanswered delivery uses.
 *
 * Durable creation intent, not Pi history or a retry queue (INV-01). Retained tombstones prevent
 * an old request from creating again after its reference was removed (INV-02). The claim stores
 * a digest of the request, never its prompt or attachments.
 */
import { createHash, randomUUID } from "node:crypto";
import { Context, Deferred, Effect, Fiber, Layer, Schema } from "effect";
import type { Attachment } from "../shared/wire.ts";
import { type PiSession, PiSessionError } from "./PiSessions.ts";
import { Registry, type RegistryError } from "./Registry.ts";
import type { CreateSpec, SessionNotCreated } from "./SessionHosts.ts";

/** The stored record: Piano's database keeps it after its session is removed. */
export const CreationAttempt = Schema.Struct({
  id: Schema.String,
  fingerprint: Schema.String,
  sessionId: Schema.String,
  cwd: Schema.String,
  state: Schema.Literals(["starting", "created", "failed", "uncertain"]),
  detail: Schema.optional(Schema.String),
});
export type CreationAttempt = typeof CreationAttempt.Type;

/** A creation under a durable identity: everything that decides what it creates and sends. */
export interface AttemptRequest extends Omit<CreateSpec, "attempt"> {
  readonly id: string;
  readonly text?: string;
  readonly attachments?: ReadonlyArray<Attachment>;
}

/** What a claimed creation carries into SessionHosts while it runs. */
export interface StartingAttempt {
  /** The fresh session identity this attempt alone may create. */
  readonly sessionId: string;
  /** Records the destination. No reference or Pi may exist before it succeeds. */
  readonly place: (cwd: string) => Effect.Effect<void, RegistryError>;
}

/** What `begin` did with a request. */
export type Begun =
  | {
      readonly _tag: "started";
      /** The claimed creation, already running under server ownership; awaiting it is optional. */
      readonly creation: Effect.Effect<PiSession, PiSessionError | SessionNotCreated>;
    }
  /** The identity was claimed by an earlier request with the same input, which owns its first
   * input: read it back with `outcome`. */
  | { readonly _tag: "duplicate" };

/** An attempt as read back. Never starts Pi or resends input. */
export type CreationOutcome =
  /** No request ever claimed this identity. */
  | { readonly _tag: "unclaimed" }
  /** No session exists and the first input was not sent. */
  | { readonly _tag: "failed"; readonly detail: string }
  /** The session exists; its first input belongs to the original request. */
  | { readonly _tag: "created"; readonly cwd: string; readonly sessionId: string }
  /** Piano cannot confirm whether a session exists or its first input was sent. */
  | { readonly _tag: "uncertain"; readonly detail: string };

const rejected = (detail: string) => new PiSessionError({ reason: "rejected", detail });
const reused =
  "This creation attempt was already used for different input. Nothing was restarted or resent.";
const unconfirmed =
  "Could not confirm the original session start. Nothing was restarted or resent.";

/** Image bytes are hashed where they are, each framed by its length: serializing them would copy
 * up to the whole attachment limit on the receive path. The field order is stored in every
 * fingerprint, so changing it refuses duplicates of claims made before. */
const fingerprintOf = (request: AttemptRequest) => {
  const digest = createHash("sha256").update(
    JSON.stringify({
      cwd: request.cwd,
      projectId: request.projectId,
      inheritProject: request.inheritProject,
      options: request.options,
      worktree: request.worktree,
      text: request.text,
      attachments: request.attachments?.map(({ data, ...image }) => ({
        ...image,
        length: data.length,
      })),
    }),
  );
  for (const image of request.attachments ?? []) digest.update(image.data);
  return digest.digest("hex");
};

export class CreationAttempts extends Context.Service<
  CreationAttempts,
  {
    /**
     * Claims `request.id` before Worktrunk, registration or Pi, then runs `create` under server
     * ownership: a requester that goes away after the claim cannot abandon it. Records
     * `SessionNotCreated` as failed and any other failure as uncertain. Fails, starting nothing,
     * when the identity was claimed for different input.
     */
    readonly begin: (
      request: AttemptRequest,
      create: (
        attempt: StartingAttempt,
      ) => Effect.Effect<PiSession, PiSessionError | SessionNotCreated>,
    ) => Effect.Effect<Begun, PiSessionError>;
    /**
     * The attempt's outcome. By default waits for a creation still running in this server; with
     * `wait: false` reads it as recorded now, so one still starting reads uncertain.
     */
    readonly outcome: (
      id: string,
      options?: { readonly wait?: boolean },
    ) => Effect.Effect<CreationOutcome, PiSessionError>;
  }
>()("piano/CreationAttempts") {}

export const CreationAttemptsLive = Layer.effect(
  CreationAttempts,
  Effect.gen(function* () {
    const registry = yield* Registry;
    const layerScope = yield* Effect.scope;
    /** Creations this server runs, by identity: owned before their claim is written. */
    const creating = new Map<
      string,
      { readonly fingerprint: string; readonly done: Deferred.Deferred<void> }
    >();
    const record = (attempt: CreationAttempt) =>
      registry
        .saveCreation(attempt)
        .pipe(Effect.catchTag("RegistryError", (e) => Effect.logWarning(e.detail)));

    const begin = Effect.fn("CreationAttempts.begin")(function* (
      request: AttemptRequest,
      create: (
        attempt: StartingAttempt,
      ) => Effect.Effect<PiSession, PiSessionError | SessionNotCreated>,
    ): Effect.fn.Return<Begun, PiSessionError> {
      const { id } = request;
      const fingerprint = fingerprintOf(request);
      // A duplicate may arrive before the original's claim is written: it is compared here, not
      // waved through as a creation it cannot confirm.
      const running = creating.get(id);
      if (running) {
        if (running.fingerprint !== fingerprint) return yield* rejected(reused);
        return { _tag: "duplicate" };
      }
      const done = yield* Deferred.make<void>();
      creating.set(id, { fingerprint, done });
      const settle = Effect.gen(function* () {
        creating.delete(id);
        yield* Deferred.succeed(done, undefined);
      });
      let attempt: CreationAttempt = {
        id,
        fingerprint,
        sessionId: randomUUID(),
        cwd: request.cwd,
        state: "starting",
      };
      const claimed = yield* registry.claimCreation(attempt).pipe(
        Effect.mapError((e) => rejected(e.detail)),
        Effect.onError(() => settle),
      );
      if (!claimed) {
        yield* settle;
        const previous = yield* registry
          .creationAttempt(id)
          .pipe(Effect.mapError((e) => rejected(e.detail)));
        if (previous && previous.fingerprint !== fingerprint) return yield* rejected(reused);
        return { _tag: "duplicate" };
      }
      const starting: StartingAttempt = {
        sessionId: attempt.sessionId,
        place: (cwd) =>
          registry.saveCreation({ ...attempt, cwd }).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                attempt = { ...attempt, cwd };
              }),
            ),
          ),
      };
      // The session is live and its claim already forbids a replay. An outcome that cannot be
      // recorded must not fail the creation and strand its first input: the read-back takes a
      // claim still `starting` as uncertain and looks for its reference.
      const fiber = yield* create(starting).pipe(
        Effect.tap(() => record({ ...attempt, state: "created" })),
        Effect.tapError((error) =>
          record({
            ...attempt,
            state: error._tag === "SessionNotCreated" ? "failed" : "uncertain",
            detail: error.detail,
          }),
        ),
        Effect.ensuring(settle),
        Effect.interruptible,
        Effect.forkIn(layerScope),
      );
      return { _tag: "started", creation: Fiber.join(fiber) };
    }, Effect.uninterruptible);

    const outcome = Effect.fn("CreationAttempts.outcome")(function* (
      id: string,
      options?: { readonly wait?: boolean },
    ): Effect.fn.Return<CreationOutcome, PiSessionError> {
      const running = creating.get(id);
      if (running && options?.wait !== false) yield* Deferred.await(running.done);
      const attempt = yield* registry
        .creationAttempt(id)
        .pipe(Effect.mapError((e) => rejected(e.detail)));
      if (!attempt) return { _tag: "unclaimed" };
      if (attempt.state === "failed")
        return { _tag: "failed", detail: attempt.detail ?? "Nothing was sent." };
      // Any other state is confirmed by its reference: a start the server stopped during may
      // still have registered its session.
      const reference = (yield* registry.get).sessions.find(
        (s) => s.sessionId === attempt.sessionId && s.cwd === attempt.cwd && !s.archived,
      );
      if (reference) return { _tag: "created", cwd: reference.cwd, sessionId: reference.sessionId };
      return {
        _tag: "uncertain",
        detail:
          attempt.state === "starting"
            ? "Piano cannot confirm the original start. Nothing was restarted or resent."
            : (attempt.detail ?? unconfirmed),
      };
    });

    return CreationAttempts.of({ begin, outcome });
  }),
);
