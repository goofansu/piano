import assert from "node:assert/strict";
import { test } from "node:test";
import { createObservation, type ObservationEnvironment } from "../web/src/lib/observation.ts";

/** A clock the test advances, a focus event it fires and a visibility flag it sets. */
function environment() {
  let now = 0, hidden = false;
  const timers = new Map<number, { at: number; run: () => void }>();
  let ids = 0;
  const focus = new Set<() => void>();
  const env: ObservationEnvironment = {
    setTimeout: (run, ms) => { const id = ++ids; timers.set(id, { at: now + ms, run }); return id; },
    clearTimeout: id => { timers.delete(id as number); },
    onFocus: listener => { focus.add(listener); return () => focus.delete(listener); },
    hidden: () => hidden,
  };
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); now = next[1].at; next[1].run();
      await settle();
    }
    now = until;
  };
  return { env, advance, focus: () => { for (const f of focus) f(); }, hide: (value: boolean) => { hidden = value; } };
}

const settle = () => new Promise<void>(resolve => setImmediate(resolve));

/** A loader whose reads the test answers one by one, recording what was asked and what was aborted. It
 * ignores aborts, like a response already on the wire, so fencing cannot rely on the loader rejecting. */
function server() {
  const reads: { key: string; signal: AbortSignal; resolve: (value: string) => void; reject: (error: Error) => void }[] = [];
  const load = (signal: AbortSignal, key: string) => new Promise<string>((resolve, reject) => {
    reads.push({ key, signal, resolve, reject });
  });
  return { reads, load };
}

test("a key change aborts the old key's read, and its late response never shows as the new key's value", async () => {
  const { env } = environment();
  const pi = server();
  const observation = createObservation({ load: pi.load, environment: env });
  observation.start();
  observation.observe("workspace-a");
  observation.observe("workspace-b");
  assert.deepEqual(pi.reads.map(r => r.key), ["workspace-a", "workspace-b"]);
  assert.equal(pi.reads[0].signal.aborted, true);
  assert.equal(pi.reads[1].signal.aborted, false);

  pi.reads[0].resolve("changes in a");
  await settle();
  assert.deepEqual({ key: observation.getState().key, value: observation.getState().value }, { key: "workspace-b", value: undefined });

  pi.reads[1].resolve("changes in b");
  await settle();
  assert.equal(observation.getState().value, "changes in b");

  // Switching back starts from nothing rather than showing a's earlier value.
  observation.observe("workspace-a");
  assert.equal(observation.getState().value, undefined);
  assert.equal(observation.getState().loading, true);
});

test("a newer read supersedes an older one for the same key; a failure keeps the last value with its reason", async () => {
  const { env } = environment();
  const pi = server();
  const observation = createObservation({ load: pi.load, environment: env });
  observation.start();
  observation.observe("k");
  pi.reads[0].resolve("first");
  await settle();
  void observation.refresh();
  void observation.refresh();
  assert.equal(pi.reads[1].signal.aborted, true);
  pi.reads[2].reject(new Error("offline"));
  await settle();
  assert.deepEqual(observation.getState(), { key: "k", value: "first", error: "offline", loading: false, mutating: false });
  void observation.refresh();
  pi.reads[3].resolve("second");
  await settle();
  assert.equal(observation.getState().error, undefined);
  assert.equal(observation.getState().value, "second");
});

test("a mutation supersedes an in-flight read, holds reads off, and its result is not overwritten by an older read", async () => {
  const { env, focus } = environment();
  const pi = server();
  const observation = createObservation({ load: pi.load, focus: true, environment: env });
  observation.start();
  observation.observe("session");
  const staleRead = pi.reads[0];
  let finish!: (value: string) => void;
  let seen: string | undefined = "unset";
  const change = observation.mutate((_signal, previous) => { seen = previous; return new Promise(resolve => { finish = resolve; }); });
  assert.equal(staleRead.signal.aborted, true);
  assert.equal(observation.getState().mutating, true);
  assert.equal(seen, undefined);

  focus();
  await observation.refresh();
  assert.equal(pi.reads.length, 1, "no read starts while the change is in flight");

  staleRead.resolve("before the change");
  finish("linked #42");
  assert.equal(await change, "linked #42");
  assert.deepEqual(observation.getState(), { key: "session", value: "linked #42", error: undefined, loading: false, mutating: false });

  // Reads resume after the change settles.
  focus();
  assert.equal(pi.reads.length, 2);
});

test("a mutation for a key that changed meanwhile does not publish, and a failed one rejects without touching the value", async () => {
  const { env } = environment();
  const pi = server();
  const observation = createObservation({ load: pi.load, environment: env });
  observation.start();
  observation.observe("a");
  pi.reads[0].resolve("a value");
  await settle();
  const failed = observation.mutate(async () => { throw new Error("rejected by GitHub"); });
  await assert.rejects(failed, /rejected by GitHub/);
  assert.equal(observation.getState().value, "a value");

  let finish!: (value: string) => void;
  const change = observation.mutate(() => new Promise(resolve => { finish = resolve; }));
  observation.observe("b");
  finish("a changed");
  assert.equal(await change, undefined);
  assert.deepEqual({ key: observation.getState().key, value: observation.getState().value, mutating: observation.getState().mutating }, { key: "b", value: undefined, mutating: false });
});

test("refresh triggers: focus, interval (skipped while hidden), a debounced trigger, and none while disabled or stopped", async () => {
  const clock = environment();
  const pi = server();
  const observation = createObservation({ load: pi.load, focus: true, interval: value => value === "installing" ? 1500 : undefined, environment: clock.env });
  const stop = observation.start();
  observation.observe("radius");
  pi.reads[0].resolve("installing");
  await settle();

  await clock.advance(1499);
  assert.equal(pi.reads.length, 1);
  await clock.advance(1);
  assert.equal(pi.reads.length, 2, "polls 1500 ms after the last read settled");
  clock.hide(true);
  pi.reads[1].resolve("installing");
  await settle();
  await clock.advance(3000);
  assert.equal(pi.reads.length, 2, "no interval reads while hidden");
  clock.hide(false);
  await clock.advance(1500);
  assert.equal(pi.reads.length, 3);
  pi.reads[2].resolve("installed");
  await settle();
  await clock.advance(10_000);
  assert.equal(pi.reads.length, 3, "polling stops when the interval says so");

  clock.focus();
  assert.equal(pi.reads.length, 4);
  pi.reads[3].resolve("installed");
  await settle();

  // Quick successive triggers coalesce into one read after the quiet period.
  observation.refreshSoon(600);
  await clock.advance(400);
  observation.refreshSoon(600);
  await clock.advance(599);
  assert.equal(pi.reads.length, 4);
  await clock.advance(1);
  assert.equal(pi.reads.length, 5);
  pi.reads[4].resolve("installed");
  await settle();

  // Disabled keeps the value but reads nothing; a pending trigger is dropped; enabling reads afresh.
  observation.refreshSoon(600);
  observation.observe("radius", false);
  clock.focus();
  await clock.advance(1000);
  assert.equal(pi.reads.length, 5);
  assert.equal(observation.getState().value, "installed");
  observation.observe("radius", true);
  assert.equal(pi.reads.length, 6);

  stop();
  assert.equal(pi.reads[5].signal.aborted, true);
  clock.focus();
  assert.equal(pi.reads.length, 6);
});
