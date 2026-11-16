import { createHash, randomUUID } from "node:crypto";
import { Context, Deferred, Effect, Fiber, Layer } from "effect";
import type { Attachment } from "../shared/wire.ts";
import type { CreationAttempt } from "./CreationAttempt.ts";
import { type PiSession, PiSessionError } from "./PiSessions.ts";
import { Registry, type RegistryError } from "./Registry.ts";
import type { CreateSpec, SessionNotCreated } from "./SessionHosts.ts";

export interface AttemptRequest extends Omit<CreateSpec, "attempt"> {
  readonly id: string;
  readonly text?: string;
  readonly attachments?: ReadonlyArray<Attachment>;
}

export interface StartingAttempt {
  readonly sessionId: string;
  readonly place: (cwd: string) => Effect.Effect<void, RegistryError>;
}

export type Begun =
  | {
      readonly _tag: "started";
      readonly creation: Effect.Effect<PiSession, PiSessionError | SessionNotCreated>;
    }
  | { readonly _tag: "duplicate" };

export type CreationOutcome =
  | { readonly _tag: "unclaimed" }
  | { readonly _tag: "failed"; readonly detail: string }
  | { readonly _tag: "created"; readonly cwd: string; readonly sessionId: string }
  | { readonly _tag: "uncertain"; readonly detail: string };

const rejected = (detail: string) => new PiSessionError({ reason: "rejected", detail });
const reused =
  "This creation attempt was already used for different input. Nothing was restarted or resent.";
const unconfirmed =
  "Could not confirm the original session start. Nothing was restarted or resent.";

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
    readonly begin: (
      request: AttemptRequest,
      create: (
        attempt: StartingAttempt,
      ) => Effect.Effect<PiSession, PiSessionError | SessionNotCreated>,
    ) => Effect.Effect<Begun, PiSessionError>;
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
