import assert from "node:assert/strict";
import { test } from "node:test";
import { createSetupActions } from "../web/src/lib/setupActions.ts";

/** A change the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function section(options: { failure?: boolean } = {}) {
  const log = { refreshes: 0, announced: [] as string[], failures: [] as string[] };
  let keys = 0;
  const actions = createSetupActions<{ name: string }, string>({
    refresh: () => {
      log.refreshes++;
    },
    success: (message) => {
      log.announced.push(message);
    },
    failure: options.failure
      ? (message) => {
          log.failures.push(message);
        }
      : undefined,
    newKey: () => `key-${++keys}`,
  });
  return { actions, log };
}

test("one change runs at a time; a second request while it runs does nothing", async () => {
  const { actions, log } = section();
  const first = deferred<string>();
  let secondRan = false;
  const running = actions.run({
    id: "install",
    run: () => first.promise,
    done: (result) => `Installed ${result}.`,
    fallback: "Could not install.",
  });
  assert.equal(actions.getState().running, "install");
  assert.equal(
    await actions.run({
      id: "uninstall",
      run: async () => {
        secondRan = true;
      },
      fallback: "x",
    }),
    undefined,
  );
  assert.equal(secondRan, false);
  first.resolve("Linear");
  assert.equal(await running, "Linear");
  assert.equal(actions.getState().running, undefined);
  assert.deepEqual(log.announced, ["Installed Linear."]);
  assert.equal(log.refreshes, 1, "the section reads its facts again once the change settles");
});

test("a confirmation closes once its change settles but keeps its subject for the closing dialog", async () => {
  const { actions } = section();
  actions.confirm({ name: "Linear" });
  const change = deferred<void>();
  const running = actions.run({
    id: "uninstall",
    run: () => change.promise,
    done: "Uninstalled.",
    fallback: "x",
  });
  actions.cancel();
  assert.equal(actions.getState().confirming, true, "a running change keeps its confirmation open");
  change.resolve();
  await running;
  assert.equal(actions.getState().confirming, false);
  assert.deepEqual(actions.getState().confirmation, { name: "Linear" });
  actions.confirm({ name: "Radius" });
  actions.cancel();
  assert.equal(actions.getState().confirming, false);
});

test("a failed change keeps its message, falls back when it has none, still refreshes, and clears when another starts", async () => {
  const { actions, log } = section();
  actions.confirm({ name: "Linear" });
  assert.equal(
    await actions.run({
      id: "sign-out",
      run: async () => {
        throw new Error("Pi refused.");
      },
      done: "Signed out.",
      fallback: "Could not sign out.",
    }),
    undefined,
  );
  assert.equal(actions.getState().error, "Pi refused.");
  assert.equal(actions.getState().confirming, false);
  assert.deepEqual(log.announced, []);
  assert.equal(log.refreshes, 1);
  await actions.run({
    id: "sign-out",
    run: async () => {
      throw "offline";
    },
    fallback: "Could not sign out.",
  });
  assert.equal(actions.getState().error, "Could not sign out.");
  const next = deferred<void>();
  const running = actions.run({ id: "install", run: () => next.promise, fallback: "x" });
  assert.equal(actions.getState().error, "", "starting another change clears the old failure");
  next.resolve();
  await running;
});

test("a section without an error alert reports failures instead of keeping them", async () => {
  const { actions, log } = section({ failure: true });
  await actions.run({
    id: "sign-out",
    run: async () => {
      throw new Error("Pi refused.");
    },
    fallback: "Could not sign out.",
  });
  assert.deepEqual(log.failures, ["Pi refused."]);
  assert.equal(actions.getState().error, "");
});

test("each sign-in opening gets its own key", () => {
  const { actions } = section();
  actions.openSignIn("radius");
  const first = actions.getState().signIn;
  actions.closeSignIn();
  assert.equal(actions.getState().signIn, undefined);
  actions.openSignIn("radius");
  assert.equal(actions.getState().signIn?.subject, "radius");
  assert.notEqual(actions.getState().signIn?.key, first?.key);
});
