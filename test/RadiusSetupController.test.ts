import assert from "node:assert/strict";
import { test } from "node:test";
import type { RadiusSetupState } from "../shared/radius.ts";
import type { ObservationEnvironment } from "../web/src/lib/observation.ts";
import { createProviderAccounts } from "../web/src/lib/providerAccounts.ts";
import {
  createRadiusSetup,
  INSTALL_POLL_MS,
  type RadiusSetupApi,
  REFRESH_SPIN_MS,
  SETUP_TOAST,
} from "../web/src/lib/radiusSetup.ts";

const ALL_SET = "All set. New Pi sessions can use Radius tools and web search.";
const INSTALLED = "Web search installed. Start a new session to use it.";
const REFRESHED = "Radius setup refreshed.";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A clock the test advances; nothing waits on real time. */
function clock() {
  let now = 0,
    ids = 0;
  const timers = new Map<number, { at: number; run: () => void }>();
  const env: ObservationEnvironment = {
    setTimeout: (run, ms) => {
      const id = ++ids;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id as number);
    },
    onFocus: () => () => {},
    hidden: () => false,
  };
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = [...timers]
        .filter(([, t]) => t.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].run();
      await settle();
    }
    now = until;
    await settle();
  };
  return { env, advance };
}

const step = (status: "missing" | "ready") =>
  status === "ready" ? { status, removalKey: "key" } : { status };
const state = (
  mcp: "missing" | "ready",
  webSearch: "missing" | "ready",
  installation: RadiusSetupState["installation"] = { status: "idle" },
): RadiusSetupState => ({ mcp: step(mcp), webSearch: step(webSearch), installation });
const running: RadiusSetupState["installation"] = { status: "running", action: "install" };
const succeeded: RadiusSetupState["installation"] = { status: "success", action: "install" };

/**
 * Radius setup over a Pi whose setup the test sets, signed in to Radius. Reads answer with the
 * current setup at once; a change answers with `answer[action]`, or the setup unchanged.
 */
async function section(initial: RadiusSetupState) {
  const { env, advance } = clock();
  const pi = {
    setup: initial,
    reads: 0,
    changes: [] as string[],
    answer: {} as Record<string, RadiusSetupState>,
  };
  const api: RadiusSetupApi = async (change) => {
    if (!change) {
      pi.reads++;
      return pi.setup;
    }
    pi.changes.push(change.action);
    pi.setup = pi.answer[change.action] ?? pi.setup;
    return pi.setup;
  };
  const accounts = createProviderAccounts({
    load: async () => [{ id: "radius", name: "Radius", signedIn: true }],
    logout: async () => {},
    environment: env,
  });
  accounts.follow({
    getState: () => ({ connected: true }),
    subscribe: () => () => {},
    listen: () => () => {},
  });
  const toasts: { message: string; id?: string }[] = [];
  const setup = createRadiusSetup({
    api,
    accounts,
    toast: (message, options) => toasts.push({ message, id: options?.id }),
    environment: env,
  });
  setup.start();
  await settle();
  return { setup, pi, toasts, advance, messages: () => toasts.map((t) => t.message) };
}

test("a web-search install that finishes during a manual refresh toasts once, after the spin", async () => {
  const { setup, pi, messages, advance } = await section(state("missing", "missing", running));
  assert.equal(setup.getState().view.webSearch.change?.label, "Installing…");
  pi.setup = state("missing", "ready", succeeded);
  setup.refreshByHand();
  await settle();
  // The read has answered, but the refresh keeps turning for one full spin.
  assert.equal(setup.getState().refreshing, true);
  assert.deepEqual(messages(), []);
  await advance(REFRESH_SPIN_MS);
  assert.equal(setup.getState().refreshing, false);
  assert.equal(setup.getState().view.settled, true);
  assert.deepEqual(messages(), [INSTALLED]);
  // A later poll interval, refresh-free, adds nothing.
  await advance(INSTALL_POLL_MS * 4);
  assert.deepEqual(messages(), [INSTALLED]);
});

test("completing setup outranks the install that completed it", async () => {
  const { setup, pi, toasts, advance } = await section(state("ready", "missing"));
  assert.equal(setup.getState().view.configured, false);
  pi.answer["install-web-search"] = state("ready", "missing", running);
  await setup.act("install-web-search");
  await settle();
  assert.equal(setup.getState().view.webSearch.change?.action, "install");
  pi.setup = state("ready", "ready", succeeded);
  await advance(INSTALL_POLL_MS);
  assert.equal(setup.getState().view.configured, true);
  assert.deepEqual(toasts, [{ message: ALL_SET, id: SETUP_TOAST }]);
});

test("polling stops once the installation settles", async () => {
  const { pi, advance } = await section(state("missing", "missing", running));
  const first = pi.reads;
  await advance(INSTALL_POLL_MS);
  assert.equal(pi.reads, first + 1);
  pi.setup = state("missing", "ready", succeeded);
  await advance(INSTALL_POLL_MS);
  const settled = pi.reads;
  await advance(INSTALL_POLL_MS * 10);
  assert.equal(pi.reads, settled);
});

test("a manual refresh with no change running confirms it refreshed, without implying completion", async () => {
  const { setup, messages, advance } = await section(state("missing", "missing"));
  assert.deepEqual(messages(), []);
  setup.refreshByHand();
  await advance(REFRESH_SPIN_MS);
  assert.deepEqual(messages(), [REFRESHED]);
  // Opening an already complete setup never announces it.
  const complete = await section(state("ready", "ready"));
  assert.deepEqual(complete.messages(), []);
});

test("a removal runs only while its confirmation is open", async () => {
  const { setup, pi } = await section(state("ready", "missing"));
  setup.confirm({ kind: "remove-mcp", key: "key" });
  setup.cancel();
  assert.equal(setup.getState().confirmation, undefined);
  setup.confirmRemoval();
  await settle();
  assert.deepEqual(pi.changes, []);
  setup.confirm({ kind: "remove-mcp", key: "key" });
  setup.confirmRemoval();
  await settle();
  assert.deepEqual(pi.changes, ["remove-mcp"]);
});
