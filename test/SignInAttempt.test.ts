import assert from "node:assert/strict";
import { test } from "node:test";
import type { ProviderLoginState } from "../shared/wire.ts";
import type { SignInRequest } from "../web/src/lib/api.ts";
import {
  CANCEL_FAILED,
  CONNECTION_LOST,
  canSubmitAnswer,
  createSignInAttempt,
  POLL_MS,
  type SignInAttemptState,
  signInDialogView,
} from "../web/src/lib/signInAttempt.ts";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A server whose replies the test gives one request at a time, and a clock the test advances. */
function harness(provider = "acme") {
  const requests: {
    request: SignInRequest;
    reply: (state: ProviderLoginState | null) => Promise<void>;
    fail: () => Promise<void>;
  }[] = [];
  const api = (request: SignInRequest = { method: "GET" }) =>
    new Promise<ProviderLoginState | null>((resolve, reject) => {
      requests.push({
        request,
        reply: async (state) => {
          resolve(state);
          await settle();
        },
        fail: async () => {
          reject(new Error("network down"));
          await settle();
        },
      });
    });
  const timers = new Map<number, () => void>();
  let ids = 0;
  let signedIn = 0;
  let closed = 0;
  const attempt = createSignInAttempt({
    api,
    provider,
    signedIn: () => signedIn++,
    close: () => closed++,
    environment: {
      setTimeout: (run, ms) => {
        assert.equal(ms, POLL_MS);
        timers.set(++ids, run);
        return ids;
      },
      clearTimeout: (id) => timers.delete(id as number),
    },
  });
  /** Fires the pending poll timer; there is at most one. */
  const tick = () => {
    assert.equal(timers.size, 1, "one poll is scheduled");
    const [[id, run]] = [...timers];
    timers.delete(id);
    run();
  };
  return {
    attempt,
    requests,
    methods: () => requests.map((r) => r.request.method),
    last: () => requests.at(-1)!,
    timers,
    tick,
    signedIn: () => signedIn,
    closed: () => closed,
  };
}

const running = (id: string, extra: Partial<ProviderLoginState> = {}): ProviderLoginState => ({
  id,
  provider: "acme",
  status: "running",
  ...extra,
});
const succeeded = (id: string): ProviderLoginState => ({
  id,
  provider: "acme",
  status: "success",
});

/** Opens on a server with no attempt, so a new one starts and comes back running. */
async function opened(h: ReturnType<typeof harness>, id = "a1") {
  h.attempt.start();
  await h.last().reply(null);
  await h.last().reply(running(id, { prompt: { id: "p1", type: "text", message: "Code?" } }));
}

test("starting twice, as a remounted dialog does, signs in once", async () => {
  const h = harness();
  const stop = h.attempt.start();
  stop();
  h.attempt.start();
  assert.deepEqual(h.methods(), ["GET"]);
  await h.last().reply(null);
  assert.deepEqual(h.methods(), ["GET", "POST"]);
  assert.deepEqual(h.last().request, { method: "POST", body: { provider: "acme" } });
  await h.last().reply(running("a1"));
  assert.equal(h.attempt.getState().attempt?.id, "a1");
  assert.equal(h.attempt.getState().busy, false);
  assert.deepEqual(h.methods(), ["GET", "POST"]);
});

test("opening re-attaches to an attempt that is already running instead of starting one", async () => {
  const h = harness();
  h.attempt.start();
  await h.last().reply(running("a0"));
  assert.deepEqual(h.methods(), ["GET"]);
  assert.equal(h.attempt.getState().attempt?.id, "a0");
});

test("a poll that answers after an answer was sent never overwrites the answer's result", async () => {
  const h = harness();
  await opened(h);
  h.tick();
  const poll = h.last();
  assert.equal(poll.request.method, "GET");
  h.attempt.answer("p1", "1234");
  assert.deepEqual(h.last().request, {
    method: "PUT",
    body: { id: "a1", promptId: "p1", value: "1234" },
  });
  const put = h.last();
  await poll.reply(running("a1", { prompt: { id: "p1", type: "text", message: "Code?" } }));
  await put.reply(running("a1", { message: "Waiting for authorization" }));
  assert.equal(h.attempt.getState().attempt?.prompt, undefined);
  assert.equal(h.attempt.getState().attempt?.message, "Waiting for authorization");
  // And when the superseded poll replies after the answer.
  const late = harness();
  await opened(late);
  late.tick();
  const latePoll = late.last();
  late.attempt.answer("p1", "1234");
  await late.last().reply(running("a1", { message: "Waiting for authorization" }));
  await latePoll.reply(running("a1", { prompt: { id: "p1", type: "text", message: "Code?" } }));
  assert.equal(late.attempt.getState().attempt?.message, "Waiting for authorization");
  assert.equal(late.attempt.getState().attempt?.prompt, undefined);
});

test("a failed poll reports a lost connection until the next poll answers", async () => {
  const h = harness();
  await opened(h);
  h.tick();
  await h.last().fail();
  assert.equal(h.attempt.getState().connectionError, CONNECTION_LOST);
  assert.equal(h.attempt.getState().attempt?.status, "running");
  h.tick();
  await h.last().reply(running("a1"));
  assert.equal(h.attempt.getState().connectionError, "");
});

test("polling stops once the attempt stops running and when the dialog stops", async () => {
  const h = harness();
  const stop = h.attempt.start();
  await h.last().reply(null);
  await h.last().reply(running("a1"));
  h.tick();
  await h.last().reply({ id: "a1", provider: "acme", status: "error", message: "denied" });
  assert.equal(h.timers.size, 0);
  h.attempt.retry();
  assert.deepEqual(h.last().request, { method: "POST", body: { provider: "acme" } });
  await h.last().reply(running("a2"));
  assert.equal(h.timers.size, 1);
  stop();
  assert.equal(h.timers.size, 0);
});

test("signedIn runs once per attempt", async () => {
  const h = harness();
  await opened(h);
  h.tick();
  await h.last().reply(succeeded("a1"));
  assert.equal(h.signedIn(), 1);
  // Remounting shows the same success without announcing it again.
  h.attempt.start()();
  h.attempt.start();
  assert.equal(h.signedIn(), 1);
  h.attempt.retry();
  await h.last().reply(succeeded("a2"));
  assert.equal(h.signedIn(), 2);
  // Dismissing a finished attempt only closes.
  h.attempt.dismiss();
  assert.equal(h.closed(), 1);
  assert.equal(h.signedIn(), 2);
  assert.equal(h.methods().includes("DELETE"), false);
});

test("signedIn runs when only the cancellation's reply shows the attempt had succeeded", async () => {
  const h = harness();
  await opened(h);
  h.attempt.dismiss();
  assert.deepEqual(h.last().request, { method: "DELETE", body: { id: "a1" } });
  await h.last().reply(succeeded("a1"));
  assert.equal(h.signedIn(), 1);
  assert.equal(h.closed(), 1);
});

test("cancelling a running attempt closes without signing in", async () => {
  const h = harness();
  await opened(h);
  h.attempt.dismiss();
  await h.last().reply({ id: "a1", provider: "acme", status: "cancelled" });
  assert.equal(h.signedIn(), 0);
  assert.equal(h.closed(), 1);
});

test("a failed cancellation stays open with an error and can be retried", async () => {
  const h = harness();
  await opened(h);
  h.attempt.dismiss();
  await h.last().fail();
  assert.equal(h.closed(), 0);
  assert.equal(h.attempt.getState().error, CANCEL_FAILED);
  assert.equal(h.attempt.getState().busy, false);
  h.attempt.dismiss();
  assert.deepEqual(h.methods().filter((m) => m === "DELETE").length, 2);
});

test("dismissing while anything is in flight is ignored", async () => {
  const h = harness();
  h.attempt.start();
  h.attempt.dismiss();
  assert.equal(h.closed(), 0);
  await h.last().reply(null);
  h.attempt.dismiss();
  await h.last().reply(running("a1", { prompt: { id: "p1", type: "text", message: "Code?" } }));
  assert.equal(h.closed(), 0);
  h.attempt.answer("p1", "x");
  h.attempt.dismiss();
  assert.deepEqual(h.methods(), ["GET", "POST", "PUT"]);
  await h.last().reply(running("a1"));
  // A cancellation already in flight is not sent twice.
  h.attempt.dismiss();
  h.attempt.dismiss();
  assert.deepEqual(h.methods(), ["GET", "POST", "PUT", "DELETE"]);
  await h.last().reply({ id: "a1", provider: "acme", status: "cancelled" });
  assert.equal(h.closed(), 1);
});

const providers = [{ id: "acme", name: "Acme", signedIn: false }];
const view = (attempt: ProviderLoginState | null, patch: Partial<SignInAttemptState> = {}) =>
  signInDialogView({
    state: { attempt, busy: false, error: "", connectionError: "", ...patch },
    provider: "acme",
    providers,
  });
const select = { id: "p1", type: "select", message: "Method?", options: [] } as const;

test("the dialog links only to http(s) sign-in pages without credentials", () => {
  for (const url of [
    "javascript:alert(1)",
    "https://user:pw@evil.example/login",
    "https://user@evil.example/login",
    "data:text/html,hi",
    "not a url",
    "",
  ]) {
    const v = view(running("a1", { url }));
    assert.equal(v.url, undefined, url);
    assert.equal(v.link, null, url);
  }
  const page = "https://acme.example/device";
  assert.equal(view(running("a1", { url: page })).url, page);
  // A finished attempt's page is no longer offered.
  assert.equal(view({ ...succeeded("a1"), url: page }).link, null);
});

test("the sign-in link shows beside a prompt or in the footer, never both", () => {
  const url = "https://acme.example/device";
  const prompt = { id: "p1", type: "manual_code", message: "Paste the code" } as const;
  const answering = view(running("a1", { url, prompt }));
  assert.equal(answering.link, "body");
  assert.equal(answering.footer, undefined);
  const waiting = view(running("a1", { url }));
  assert.equal(waiting.link, "footer");
  assert.equal(waiting.description, "Waiting for authorization…");
  assert.equal(view(running("a1", { prompt: select })).description, "Choose a sign-in method.");
});

test("each status gives the dialog its dismiss label and retry", () => {
  const footer = (attempt: ProviderLoginState | null, busy = false) =>
    view(attempt, { busy }).footer;
  const cancel = { dismissLabel: "Cancel", dismissPrimary: false, retry: false };
  assert.deepEqual(footer(null, true), cancel);
  assert.deepEqual(footer(running("a1")), cancel);
  assert.deepEqual(footer(succeeded("a1")), {
    dismissLabel: "Done",
    dismissPrimary: true,
    retry: false,
  });
  for (const status of ["error", "cancelled"] as const)
    assert.deepEqual(footer({ id: "a1", provider: "acme", status }), {
      dismissLabel: "Close",
      dismissPrimary: false,
      retry: true,
    });
  assert.equal(view(null).title, "Sign in to Acme");
  assert.equal(view(null, { busy: true }).loading, true);
  assert.equal(view(running("a1", { prompt: select }), { busy: true }).loading, false);
  const lost = { connectionError: CONNECTION_LOST };
  assert.equal(view(running("a1"), lost).alert, CONNECTION_LOST);
  assert.equal(view(running("a1"), { ...lost, error: "denied" }).alert, "denied");
});

test("a prompt's answer can be sent only when idle and, for a select, once chosen", () => {
  assert.equal(canSubmitAnswer({ prompt: select, busy: false, value: "" }), false);
  assert.equal(canSubmitAnswer({ prompt: select, busy: false, value: "device" }), true);
  assert.equal(canSubmitAnswer({ prompt: select, busy: true, value: "device" }), false);
  const text = { id: "p2", type: "text", message: "Code?" } as const;
  assert.equal(canSubmitAnswer({ prompt: text, busy: false, value: "" }), true);
  assert.equal(canSubmitAnswer({ prompt: text, busy: true, value: "x" }), false);
});
