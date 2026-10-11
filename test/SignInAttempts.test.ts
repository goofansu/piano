import assert from "node:assert/strict";
import { test } from "node:test";
import { Effect, Exit, Scope } from "effect";
import { type SignInAttempt, SignInAttempts, type SignInOutcome, type SignInPolicy, type SignInState } from "../server/SignInAttempts.ts";

// The attempt lifecycle both provider and MCP sign-in share, driven by a scripted source in place of Pi.
const until = (attempts: SignInAttempts, predicate: (state: SignInState) => boolean) => Effect.gen(function* () {
  for (;;) {
    const state = yield* attempts.state;
    if (state && predicate(state)) return state;
    yield* Effect.sleep(1);
  }
}).pipe(Effect.timeout("3 seconds"));
const lane = (policy: Partial<SignInPolicy> = {}) => SignInAttempts.make({ busy: "Busy.", afterSuccess: Effect.void, ...policy });
const detail = <A>(effect: Effect.Effect<A, { readonly detail: string }>) => Effect.map(Effect.flip(effect), error => error.detail);
const source = (run: (attempt: SignInAttempt) => Promise<SignInOutcome>) => ({ failure: "Sign-in failed.", run });

test("INV-04: an answer is claimed once; stale, foreign and invalid answers fail with their own detail", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const attempts = yield* lane();
    const answers: string[] = [];
    const started = yield* attempts.start("radius", source(async ({ ask }) => {
      answers.push(await ask({ type: "select", message: "Method", options: [{ id: "device", label: "Device code" }] }));
      answers.push(await ask({ type: "text", message: "Code" }, { check: value => value.startsWith("ok") ? undefined : "Paste the code." }));
      return { status: "success", message: "Signed in." };
    }));
    assert.equal(yield* detail(attempts.start("other", source(async () => ({ status: "success", message: "" })))), "Busy.");
    const method = yield* until(attempts, s => !!s.prompt);
    assert.equal(yield* detail(attempts.answer(started.id, method.prompt!.id, "invalid")), "Choose one of the offered options.");
    assert.equal(yield* detail(attempts.answer("other", method.prompt!.id, "device")), "This sign-in prompt has already closed. Refresh and try again.");
    // Competing tabs answer the same prompt at once: exactly one wins.
    const competing = yield* Effect.all([0, 1, 2].map(() => Effect.result(attempts.answer(started.id, method.prompt!.id, "device"))), { concurrency: "unbounded" });
    assert.deepEqual(competing.map(r => r._tag).sort(), ["Failure", "Failure", "Success"]);
    const code = yield* until(attempts, s => s.prompt?.message === "Code");
    // A refused answer keeps the prompt open.
    assert.equal(yield* detail(attempts.answer(started.id, code.prompt!.id, "typo")), "Paste the code.");
    assert.equal((yield* attempts.state)?.prompt?.id, code.prompt!.id);
    yield* attempts.answer(started.id, code.prompt!.id, "ok-1");
    const done = yield* until(attempts, s => s.status !== "running");
    assert.deepEqual({ status: done.status, message: done.message, prompt: done.prompt }, { status: "success", message: "Signed in.", prompt: undefined });
    assert.deepEqual(answers, ["device", "ok-1"]);
    assert.equal(yield* detail(attempts.answer(started.id, code.prompt!.id, "ok-2")), "This sign-in prompt has already closed. Refresh and try again.");
  })));
});

test("INV-04: a prompt's own signal closes only that prompt; cancelling ends the attempt and rejects late answers", async () => {
  const callback = new AbortController();
  let aborted = false;
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const attempts = yield* lane({ afterSuccess: Effect.sync(() => assert.fail("a cancelled attempt did not succeed")) });
    const started = yield* attempts.start("radius", source(async ({ ask, signal }) => {
      await ask({ type: "manual_code", message: "Pending callback" }, { signal: callback.signal }).catch(() => undefined);
      signal.addEventListener("abort", () => { aborted = true; });
      await ask({ type: "text", message: "Next step" });
      return { status: "success", message: "Should not complete." };
    }));
    const first = yield* until(attempts, s => !!s.prompt);
    callback.abort();
    const next = yield* until(attempts, s => s.prompt?.message === "Next step");
    assert.notEqual(next.prompt!.id, first.prompt!.id);
    assert.equal(next.status, "running");
    assert((yield* Effect.result(attempts.answer(started.id, first.prompt!.id, "late")))._tag === "Failure");
    assert.equal(yield* detail(attempts.cancel("not-current")), "This sign-in is no longer current.");
    const cancelled = yield* attempts.cancel(started.id);
    assert.equal(cancelled.status, "cancelled");
    assert(!cancelled.prompt);
    assert(aborted, "cancelling aborts the source's flow");
    assert((yield* Effect.result(attempts.answer(started.id, next.prompt!.id, "late")))._tag === "Failure");
  })));
});

test("an attempt expires at its deadline, and closing the scope cancels a running one and waits for it", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const attempts = yield* lane({ expiresAfterMs: 20 });
    yield* attempts.start("radius", source(({ ask }) => ask({ type: "text", message: "Never answered" }).then(() => ({ status: "success", message: "" }))));
    const expired = yield* until(attempts, s => s.status !== "running");
    assert.deepEqual({ status: expired.status, message: expired.message }, { status: "cancelled", message: "Sign-in expired. Please try again." });
    // The lane is free again once the flow has ended.
    yield* until(attempts, () => !attempts.busy());
  })));

  let settled = false;
  const scope = Scope.makeUnsafe();
  const attempts = await Effect.runPromise(Scope.provide(lane(), scope));
  await Effect.runPromise(attempts.start("radius", source(async ({ signal }) => {
    await new Promise(resolve => signal.addEventListener("abort", resolve));
    await new Promise(resolve => setTimeout(resolve, 10));
    settled = true;
    return { status: "error", message: "" };
  })));
  await Effect.runPromise(Scope.close(scope, Exit.void));
  assert(settled, "shutdown waits for the flow to settle");
  assert.deepEqual(await Effect.runPromise(Effect.map(attempts.state, s => [s?.status, s?.message])), ["cancelled", "Sign-in cancelled: Piano stopped."]);
});

test("INV-11: a thrown flow error is replaced by the source's failure; success runs afterSuccess before it is reported", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    let invalidated = 0;
    // A slow invalidation: success reported before it finishes would be seen with the count still 0.
    const attempts = yield* lane({ afterSuccess: Effect.delay(Effect.sync(() => { invalidated++; }), "10 millis") });
    yield* attempts.start("radius", source(async () => { throw new Error("Token exchange: secret-response-token"); }));
    const failed = yield* until(attempts, s => s.status !== "running");
    assert.deepEqual({ status: failed.status, message: failed.message }, { status: "error", message: "Sign-in failed." });
    assert(!JSON.stringify(failed).includes("secret"));
    assert.equal(invalidated, 0);
    yield* until(attempts, () => !attempts.busy());
    yield* attempts.start("radius", source(async () => ({ status: "success", message: "Signed in." })));
    yield* until(attempts, s => s.status === "success");
    assert.equal(invalidated, 1, "success is visible only after afterSuccess has run");
  })));
});

test("an exclusive operation and an attempt never overlap", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const attempts = yield* lane();
    const competing = yield* Effect.all([
      Effect.result(attempts.exclusive(Effect.sleep(5), "Signing out.")),
      Effect.result(attempts.start("radius", source(async () => ({ status: "success", message: "" })))),
      Effect.result(attempts.exclusive(Effect.void, "Signing out.")),
    ], { concurrency: "unbounded" });
    assert.deepEqual(competing.map(r => r._tag), ["Success", "Failure", "Failure"]);
    let release = () => {};
    const released = new Promise<void>(resolve => { release = resolve; });
    yield* attempts.start("radius", source(async () => { await released; return { status: "success", message: "" }; }));
    assert(attempts.busy("radius") && !attempts.busy("linear"));
    assert.equal(yield* detail(attempts.exclusive(Effect.void, "Finish signing in first.")), "Finish signing in first.");
    release();
    yield* until(attempts, () => !attempts.busy());
    yield* attempts.forget("radius");
    assert.equal(yield* attempts.state, null);
  })));
});
