import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type CheckoutRefreshEnvironment,
  type CheckoutRefreshState,
  createCheckoutRefresh,
} from "../web/src/lib/checkoutRefresh.ts";

/** A clock the test advances, and focus and visibility events it fires. */
function environment() {
  let now = 0,
    hidden = false;
  const timers = new Map<number, { at: number; run: () => void }>();
  let ids = 0;
  const focus = new Set<() => void>();
  const visibility = new Set<() => void>();
  const env: CheckoutRefreshEnvironment = {
    setTimeout: (run, ms) => {
      const id = ++ids;
      timers.set(id, { at: now + ms, run });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id as number);
    },
    onFocus: (listener) => {
      focus.add(listener);
      return () => focus.delete(listener);
    },
    onVisibilityChange: (listener) => {
      visibility.add(listener);
      return () => visibility.delete(listener);
    },
    hidden: () => hidden,
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = [...timers]
        .filter(([, t]) => t.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].run();
    }
    now = until;
  };
  return {
    env,
    advance,
    focus: () => {
      for (const f of focus) f();
    },
    setHidden: (value: boolean) => {
      hidden = value;
      for (const f of visibility) f();
    },
    listening: () => focus.size + visibility.size,
  };
}

type Session = NonNullable<CheckoutRefreshState["session"]>;
const session = (patch: Partial<Session> = {}): Session => ({
  cwd: "/repo",
  messages: [],
  state: { isStreaming: false },
  ...patch,
});

/** The page's client: its state, its subscribers and every registry request sent. */
function client(initial: Partial<CheckoutRefreshState> = {}) {
  let state: CheckoutRefreshState = {
    connected: true,
    view: { kind: "session" },
    session: session(),
    ...initial,
  };
  const listeners = new Set<() => void>();
  let sent = 0;
  return {
    source: {
      getState: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      send: (command: { _tag: string }) => {
        assert.equal(command._tag, "registry");
        sent++;
      },
    },
    set: (patch: Partial<CheckoutRefreshState>) => {
      state = { ...state, ...patch };
      for (const listener of listeners) listener();
    },
    /** Requests sent since the last call. */
    take: () => {
      const n = sent;
      sent = 0;
      return n;
    },
  };
}

test("a shown session refreshes now, after the debounce, then every 5 seconds while visible", () => {
  const clock = environment();
  const page = client();
  createCheckoutRefresh({ environment: clock.env }).follow(page.source);
  assert.equal(page.take(), 1, "refreshes as the session shows");
  clock.advance(250);
  assert.equal(page.take(), 1, "the debounced trigger fires once");
  clock.advance(4750);
  assert.equal(page.take(), 1, "polls at 5 seconds");
  clock.advance(5000);
  assert.equal(page.take(), 1);
  clock.setHidden(true);
  assert.equal(page.take(), 0, "hiding the page does not refresh");
  clock.advance(10_000);
  assert.equal(page.take(), 0, "polls skip a hidden page");
  clock.setHidden(false);
  assert.equal(page.take(), 1, "becoming visible refreshes");
  clock.focus();
  assert.equal(page.take(), 1, "focus refreshes");
});

test("checkout-changing tool results and streaming changes coalesce into one refresh", () => {
  const clock = environment();
  const page = client();
  createCheckoutRefresh({ environment: clock.env }).follow(page.source);
  clock.advance(250);
  page.take();

  page.set({ session: session({ state: { isStreaming: true } }) });
  clock.advance(100);
  page.set({
    session: session({
      state: { isStreaming: true },
      messages: [{ id: "m1", role: "tool_result", toolName: "edit" }],
    }),
  });
  clock.advance(100);
  page.set({
    session: session({
      state: { isStreaming: true },
      messages: [
        { id: "m1", role: "tool_result", toolName: "edit" },
        { id: "m2", role: "assistant" },
      ],
    }),
  });
  clock.advance(149);
  assert.equal(page.take(), 0, "streamed text does not restart or fire the debounce early");
  clock.advance(1);
  assert.equal(page.take(), 1, "one refresh 250 ms after the last checkout-changing update");
  clock.advance(1000);
  assert.equal(page.take(), 0);
});

test("nothing refreshes while disconnected or without a session", () => {
  const clock = environment();
  const page = client({ connected: false });
  const stop = createCheckoutRefresh({ environment: clock.env }).follow(page.source);
  clock.advance(20_000);
  clock.focus();
  assert.equal(page.take(), 0, "disconnected");
  assert.equal(clock.listening(), 0);

  page.set({ connected: true, view: { kind: "new" }, session: null });
  clock.advance(20_000);
  assert.equal(page.take(), 0, "no session on screen");

  page.set({ view: { kind: "session" }, session: session() });
  assert.equal(page.take(), 1, "a session on screen refreshes at once");
  clock.advance(5000);
  assert.equal(page.take(), 2, "debounce and first poll");

  page.set({ connected: false });
  clock.advance(20_000);
  clock.focus();
  assert.equal(page.take(), 0, "losing the connection stops refreshing");
  assert.equal(clock.listening(), 0, "and releases focus and visibility");

  page.set({ connected: true });
  assert.equal(page.take(), 1, "reconnecting refreshes again");
  stop();
  clock.advance(20_000);
  clock.focus();
  page.set({ session: session({ cwd: "/other" }) });
  assert.equal(page.take(), 0, "stopping ends all refreshes");
  assert.equal(clock.listening(), 0);
});
