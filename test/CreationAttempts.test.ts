import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Deferred, Effect, Layer, type Scope } from "effect";
import {
  type AttemptRequest,
  CreationAttempts,
  CreationAttemptsLive,
  type StartingAttempt,
} from "../server/CreationAttempts.ts";
import { type PiSession, PiSessionError } from "../server/PiSessions.ts";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionNotCreated } from "../server/SessionHosts.ts";

const root = mkdtempSync(join(tmpdir(), "piano-creation-attempt-"));
after(() => rmSync(root, { recursive: true, force: true }));

let databases = 0;
const run = <A, E>(
  effect: Effect.Effect<A, E, CreationAttempts | Registry | Scope.Scope>,
  path = join(root, `registry-${++databases}.db`),
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.scoped,
      Effect.provide(CreationAttemptsLive.pipe(Layer.provideMerge(RegistryLive))),
      Effect.provideService(RegistryDatabasePath, path),
      Effect.timeout("10 seconds"),
    ),
  );

const request = (input: Partial<AttemptRequest> = {}): AttemptRequest => ({
  id: "attempt",
  cwd: "/repo",
  options: {},
  text: "one input",
  ...input,
});
/** The session SessionHosts would create: it places the attempt and registers the reference. */
const registers = (registry: Registry["Service"]) => (attempt: StartingAttempt) =>
  Effect.gen(function* () {
    yield* attempt.place("/repo");
    yield* registry.addSession("/repo", attempt.sessionId);
    return {} as PiSession;
  }).pipe(Effect.orDie);
const started = <A extends { readonly _tag: string }>(begun: A) => {
  assert.equal(begun._tag, "started");
  return begun as Extract<A, { readonly _tag: "started" }>;
};

test("INV-02: an identity reused for different input is refused while its original runs and after, never creating again", async () => {
  await run(
    Effect.gen(function* () {
      const attempts = yield* CreationAttempts;
      const registry = yield* Registry;
      const gate = yield* Deferred.make<void>();
      let creations = 0;
      const create = (attempt: StartingAttempt) =>
        Effect.sync(() => creations++).pipe(
          Effect.andThen(Deferred.await(gate)),
          Effect.andThen(registers(registry)(attempt)),
        );
      const original = started(yield* attempts.begin(request(), create));
      const running = yield* Effect.flip(attempts.begin(request({ text: "other input" }), create));
      assert.match(running.detail, /already used for different input/);
      assert.equal((yield* attempts.begin(request(), create))._tag, "duplicate");
      yield* Deferred.succeed(gate, undefined);
      yield* original.creation;
      const settled = yield* Effect.flip(
        attempts.begin(
          request({
            attachments: [{ kind: "image", name: "a.png", mimeType: "image/png", data: "AA==" }],
          }),
          create,
        ),
      );
      assert.match(settled.detail, /already used for different input/);
      assert.equal((yield* attempts.begin(request(), create))._tag, "duplicate");
      assert.equal(creations, 1, "only the original created");
    }),
  );
});

test("the read-back waits for the original and says whether its session exists", async () => {
  await run(
    Effect.gen(function* () {
      const attempts = yield* CreationAttempts;
      const registry = yield* Registry;
      assert.deepEqual(yield* attempts.outcome("never"), { _tag: "unclaimed" });

      const gate = yield* Deferred.make<void>();
      const created = started(
        yield* attempts.begin(request({ id: "created" }), (attempt) =>
          Deferred.await(gate).pipe(Effect.andThen(registers(registry)(attempt))),
        ),
      );
      // As recorded now, a start still under way cannot be confirmed.
      assert.equal((yield* attempts.outcome("created", { wait: false }))._tag, "uncertain");
      yield* Deferred.succeed(gate, undefined);
      const outcome = yield* attempts.outcome("created");
      assert.equal(outcome._tag, "created");
      const [ref] = (yield* registry.get).sessions;
      assert.deepEqual(outcome, { _tag: "created", cwd: ref!.cwd, sessionId: ref!.sessionId });
      yield* created.creation;

      const notCreated = started(
        yield* attempts.begin(request({ id: "failed" }), () =>
          Effect.fail(new SessionNotCreated({ detail: "No Pi.", checkoutUnconfirmed: false })),
        ),
      );
      assert.deepEqual(yield* attempts.outcome("failed"), { _tag: "failed", detail: "No Pi." });
      yield* Effect.flip(notCreated.creation);

      const broken = started(
        yield* attempts.begin(request({ id: "broken" }), () =>
          Effect.fail(new PiSessionError({ reason: "rejected", detail: "Pi stopped." })),
        ),
      );
      assert.deepEqual(yield* attempts.outcome("broken"), {
        _tag: "uncertain",
        detail: "Pi stopped.",
      });
      yield* Effect.flip(broken.creation);
    }),
  );
});

test("INV-02: claims and their outcomes survive restart; a duplicate never creates", async () => {
  const path = join(root, "restart.db");
  await run(
    Effect.gen(function* () {
      const attempts = yield* CreationAttempts;
      const failed = started(
        yield* attempts.begin(request({ id: "failed" }), () =>
          Effect.fail(new SessionNotCreated({ detail: "No Pi.", checkoutUnconfirmed: false })),
        ),
      );
      yield* Effect.flip(failed.creation);
      // The server stops before this creation does anything.
      yield* attempts.begin(request({ id: "abandoned" }), () => Effect.never);
    }),
    path,
  );
  await run(
    Effect.gen(function* () {
      const attempts = yield* CreationAttempts;
      const create = () => Effect.die("a duplicate must not create");
      assert.equal((yield* attempts.begin(request({ id: "failed" }), create))._tag, "duplicate");
      assert.equal((yield* attempts.begin(request({ id: "abandoned" }), create))._tag, "duplicate");
      assert.deepEqual(yield* attempts.outcome("failed"), { _tag: "failed", detail: "No Pi." });
      const abandoned = yield* attempts.outcome("abandoned");
      assert.equal(abandoned._tag, "uncertain");
      assert.match(abandoned._tag === "uncertain" ? abandoned.detail : "", /cannot confirm/);
    }),
    path,
  );
});
