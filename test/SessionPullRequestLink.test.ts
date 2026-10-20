import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  PullRequest,
  SessionPullRequest,
  SessionPullRequestAction,
  SessionPullRequestLink,
} from "../shared/wire.ts";
import type { ObservationEnvironment } from "../web/src/lib/observation.ts";
import { createSessionPullRequest } from "../web/src/lib/sessionPullRequest.ts";

/** Timers that never fire on their own and a focus nobody gives, so every read here is one the test caused. */
const environment: ObservationEnvironment = {
  setTimeout: () => undefined,
  clearTimeout: () => {},
  onFocus: () => () => {},
  hidden: () => false,
};

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

const URL = "https://github.com/example/repo/pull/42";
const registered: SessionPullRequestLink = { url: URL, source: "manual" };
const unlinked: SessionPullRequest = { link: null, pullRequest: null };
const linked: SessionPullRequest = { link: registered, pullRequest: null };

/** Piano's PR endpoint, answered by the test one request at a time. */
function server() {
  const requests: {
    action: SessionPullRequestAction | undefined;
    signal: AbortSignal;
    resolve: (body: SessionPullRequest) => void;
    reject: (error: Error) => void;
  }[] = [];
  return {
    requests,
    api: (
      _workspaceId: string,
      _sessionId: string,
      action: SessionPullRequestAction | undefined,
      { signal }: { signal: AbortSignal },
    ) =>
      new Promise<SessionPullRequest>((resolve, reject) =>
        requests.push({ action, signal, resolve, reject }),
      ),
    last: () => requests[requests.length - 1]!,
  };
}

/** Observes session s1 with the registry link the catalog reports for it. */
function setup(link: SessionPullRequestLink | null | undefined, env = environment, now = Date.now) {
  const pi = server();
  const notes: { error: string[]; info: string[] } = { error: [], info: [] };
  let closes = 0;
  const pr = createSessionPullRequest({
    api: pi.api,
    notify: { error: (m) => notes.error.push(m), info: (m) => notes.info.push(m) },
    closed: () => closes++,
    environment: env,
    now,
  });
  const stop = pr.start();
  pr.observe("w1", "s1", link, false);
  return { pi, pr, notes, stop, closes: () => closes };
}

test("only a session the registry links is read; its link changing or going elsewhere is followed", async () => {
  const { pi, pr } = setup(undefined);
  assert.equal(pi.requests.length, 0, "a never-searched session asks nothing when selected");
  pr.observe("w1", "s2", null, false);
  pr.observe("w1", "s2", null, true);
  pr.observe("w1", "s2", null, false);
  assert.equal(pi.requests.length, 0, "a session whose link was removed asks nothing either");

  pr.observe("w1", "s3", registered, false);
  assert.equal(pi.requests.length, 1, "a linked session reads its facts");
  assert.equal(pi.last().action, undefined);
  pi.last().resolve(linked);
  await settle();
  assert.equal(pr.getState().value?.link?.url, URL);

  const other = "https://github.com/example/repo/pull/43";
  pr.observe("w1", "s3", { url: other, source: "manual" }, false);
  assert.equal(pi.requests.length, 2, "a link changed elsewhere is read afresh");
  assert.equal(
    pr.getState().value,
    undefined,
    "the old link's facts are not shown for the new one",
  );
  pi.last().resolve({ ...linked, link: { url: other, source: "manual" } });
  await settle();
  assert.equal(pr.getState().value?.link?.url, other);

  pr.observe("w1", "s3", null, false);
  assert.equal(pi.requests.length, 2, "a link removed elsewhere stops reading");
  assert.equal(pr.getState().value, undefined, "and shows no link");
});

test("pending association changes supersede reads and fence late success and failure", async () => {
  const { pi, pr, notes, stop } = setup(registered);
  const a = pi.last();
  const b = { ...registered, url: "https://github.com/example/repo/pull/43" };
  pr.observe("w1", "s1", b, false);
  assert.equal(pi.requests.length, 2, "B reads immediately without a timer or work edge");
  assert.equal(a.signal.aborted, true);
  const readB = pi.last();
  pr.observe("w1", "s1", { ...b }, false);
  assert.equal(pi.requests.length, 2, "equivalent broadcasts leave B running");
  const c: SessionPullRequestLink = { ...b, apiHost: "github.int.exe.xyz" };
  pr.observe("w1", "s1", c, true);
  assert.equal(pi.requests.length, 3, "host change and work edge share one read");
  assert.equal(readB.signal.aborted, true);
  pi.last().resolve({ link: c, pullRequest: null });
  await settle();
  a.resolve(linked);
  readB.reject(new Error("stale B failure"));
  await settle();
  assert.deepEqual(pr.getState().value, { link: c, pullRequest: null });
  assert.deepEqual(notes.error, []);
  pr.open();
  assert.equal(pr.getState().surface, "details");
  stop();
});

test("selection and becoming linked each start only one read, even with a work edge", async () => {
  const { pi, pr, stop } = setup(registered);
  pi.last().resolve(linked);
  await settle();
  const b = { ...registered, url: "https://github.com/example/repo/pull/43" };
  pr.observe("w1", "s2", b, true);
  assert.equal(pi.requests.length, 2);
  assert.equal(pi.last().signal.aborted, false);
  pr.observe("w1", "s2", null, true);
  assert.equal(pi.last().signal.aborted, true);
  pi.last().resolve({ link: b, pullRequest: null });
  await settle();
  assert.equal(pr.getState().value, undefined);
  pr.observe("w1", "s2", b, false);
  assert.equal(pi.requests.length, 3);
  assert.equal(pi.last().signal.aborted, false);
  stop();
});

for (const action of ["link", "discover", "remove"] as const) {
  for (const conflicting of [false, true]) {
    test(`${action} survives an early registry ${conflicting ? "conflict and reconciles" : "acknowledgement"}`, async () => {
      const { pi, pr, stop } = setup(action === "discover" ? undefined : registered);
      if (action !== "discover") {
        pi.last().resolve(linked);
        await settle();
      }
      const b = { ...registered, url: "https://github.com/example/repo/pull/43" };
      const result = action === "remove" ? unlinked : { link: b, pullRequest: null };
      const saving = action === "link" ? pr.link(b.url) : pr[action]();
      const mutation = pi.last();
      const sent = pi.requests.length;
      const next = conflicting ? { ...b, source: "branch" as const } : result.link;
      pr.observe("w1", "s1", next, true);
      assert.equal(mutation.signal.aborted, false);
      assert.equal(pi.requests.length, sent, "registry and work edge do not interrupt a change");
      mutation.resolve(result);
      assert.equal((await saving)._tag, "saved");
      assert.equal(pi.requests.length, sent + (conflicting ? 1 : 0));
      if (conflicting) {
        assert.equal(pr.getState().value, undefined, "the conflicting mutation is not current");
        pi.last().resolve({ link: next, pullRequest: null });
        await settle();
      }
      assert.deepEqual(pr.getState().value?.link, next);
      stop();
    });
  }
}

test("a changed association keeps an edit and a failed refresh uses the new link", async () => {
  const { pi, pr, stop } = setup(registered);
  pi.last().resolve(linked);
  await settle();
  pr.open();
  pr.edit();
  const b: SessionPullRequestLink = { ...registered, apiHost: "github.int.exe.xyz" };
  pr.observe("w1", "s1", b, false);
  assert.equal(pr.getState().value, undefined, "old host facts are not current");
  assert.equal(pr.getState().surface, "editing");
  pi.last().reject(new Error("B is offline"));
  await settle();
  assert.deepEqual(pr.getState().value, { link: b, pullRequest: null, error: "B is offline" });
  assert.equal(pr.getState().surface, "editing");
  stop();
});

test("opening while unlinked offers the link form; a link found when work stops closes it", async () => {
  const { pi, pr, closes } = setup(undefined);
  pr.open();
  assert.equal(pr.getState().surface, "link-form");

  // The session's turn ends: the background search asks the server, which saves what it finds.
  pr.observe("w1", "s1", undefined, true);
  assert.equal(pi.requests.length, 0, "starting work searches nothing");
  pr.observe("w1", "s1", undefined, false);
  assert.equal(pi.requests.length, 1);
  assert.equal(pi.last().action, undefined, "the search is a read, which discovers server-side");
  pi.last().resolve(linked);
  await settle();
  assert.equal(pr.getState().surface, "link-form", "the search's own answer shows nothing");

  // The catalog reports the saved link; that starts reading, and the link closes the form.
  pr.observe("w1", "s1", registered, false);
  assert.equal(pi.requests.length, 2);
  pi.last().resolve(linked);
  await settle();
  assert.equal(pr.getState().surface, "closed");
  assert.equal(closes(), 1, "whoever owns the panel learns it closed");
  pr.open();
  assert.equal(pr.getState().surface, "details", "reopening shows the link");
});

test("opening a linked session before its first read lands shows its details throughout", async () => {
  const { pi, pr, closes } = setup(registered);
  assert.equal(pi.requests.length, 1, "selection starts the first read");
  pr.open();
  assert.equal(
    pr.getState().surface,
    "details",
    "the registry's link decides, not the pending read",
  );
  assert.equal(pr.getState().linked, true);
  assert.equal(pr.getState().value, undefined, "no facts yet");
  assert.equal(pi.requests.length, 1, "opening joins the first read");
  pi.last().resolve(linked);
  await settle();
  assert.equal(pr.getState().surface, "details", "the read fills the details in place");
  assert.deepEqual(pr.getState().value, linked);
  assert.equal(closes(), 0, "the panel never closes itself");
  assert.equal(pi.requests.length, 1);
});

test("opening details reuses the loaded facts without replacing a background read", async () => {
  const { pi, pr } = setup(registered);
  pi.last().resolve(linked);
  await settle();
  pr.open();
  assert.equal(pr.getState().surface, "details");
  assert.deepEqual(pr.getState().value, linked);
  assert.equal(pi.requests.length, 1, "opening uses the header's facts");
  pr.close();
  pr.open();
  assert.equal(pi.requests.length, 1, "reopening does not read again either");

  pr.close();
  pr.observe("w1", "s1", registered, true);
  assert.equal(pi.requests.length, 2, "work starting still refreshes the facts");
  pr.open();
  assert.equal(pi.requests.length, 2, "opening leaves an in-flight refresh alone");
  const unavailable = { ...linked, error: "GitHub is unreachable" };
  pi.last().resolve(unavailable);
  await settle();
  assert.equal(pr.getState().surface, "details");
  assert.deepEqual(pr.getState().value, unavailable, "the refresh updates the open details");
});

/** A controllable clock: no real minute-long sleeps or browser focus needed. */
function clock() {
  let time = 0;
  let hidden = false;
  let focus = () => {};
  const timers = new Map<object, { at: number; run: () => void }>();
  const env: ObservationEnvironment = {
    setTimeout: (run, ms) => {
      const id = {};
      timers.set(id, { at: time + ms, run });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id as object);
    },
    onFocus: (listener) => {
      focus = listener;
      return () => {
        focus = () => {};
      };
    },
    hidden: () => hidden,
  };
  return {
    env,
    now: () => time,
    pending: () => timers.size,
    focus: () => focus(),
    hide: (value: boolean) => {
      hidden = value;
    },
    advance: async (ms: number) => {
      const until = time + ms;
      for (;;) {
        const next = [...timers]
          .filter(([, timer]) => timer.at <= until)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        timers.delete(next[0]);
        time = next[1].at;
        next[1].run();
        await settle();
      }
      time = until;
    },
  };
}

const facts = (state: PullRequest["state"]): SessionPullRequest => ({
  link: registered,
  pullRequest: {
    url: URL,
    repo: "example/repo",
    number: 42,
    title: "A pull request",
    state,
    checks: "pending",
    review: "none",
  },
});

const unavailable: SessionPullRequest = {
  ...linked,
  error: "HTTP 503: Service Unavailable (https://api.github.com/repos/example/repo/pulls/42)",
};

test("visible PR details recover from a successful error-body poll without user interaction", async () => {
  const time = clock();
  let calls = 0;
  const pr = createSessionPullRequest({
    api: async () => (++calls === 2 ? unavailable : facts("open")),
    notify: { error: assert.fail, info: assert.fail },
    environment: time.env,
    now: time.now,
  });
  const stop = pr.start();
  try {
    pr.observe("w1", "s1", registered, false);
    await settle();
    pr.open();
    await time.advance(60_000);
    assert.equal(calls, 2);
    assert.deepEqual(pr.getState().value, unavailable, "old check results are not current");

    await time.advance(600_000);
    assert.equal(calls, 12, "scheduled reads continue for ten minutes without focus or reopening");
    assert.equal(pr.getState().value?.pullRequest?.state, "open");
    assert.equal(time.pending(), 1, "exactly one next poll remains");
  } finally {
    stop();
  }
});

for (const initial of [unavailable, linked]) {
  test(`initial ${initial.error ? "error-body" : "unknown"} details retry once per interval despite equivalent broadcasts`, async () => {
    const time = clock();
    const { pi, pr, stop } = setup(registered, time.env, time.now);
    try {
      pi.last().resolve(initial);
      await settle();
      pr.open();
      assert.equal(time.pending(), 1);
      await time.advance(30_000);
      pr.observe("w1", "s1", { ...registered }, false);
      assert.equal(pi.requests.length, 1);
      assert.equal(time.pending(), 1);
      await time.advance(30_000);
      assert.equal(pi.requests.length, 2, "broadcast did not postpone or duplicate the retry");
      assert.deepEqual(pr.getState().value, initial, "unavailable facts stay visible during retry");
      pr.observe("w1", "s1", { ...registered }, false);
      await time.advance(120_000);
      assert.equal(pi.requests.length, 2, "a slow retry is neither duplicated nor superseded");
      assert.equal(pi.last().signal.aborted, false);
      pi.last().resolve(facts("open"));
      await settle();
      assert.equal(pr.getState().value?.pullRequest?.state, "open");
      assert.equal(time.pending(), 1);
    } finally {
      stop();
    }
  });
}

test("unavailable details pause recovery while hidden, editing or closed", async () => {
  const time = clock();
  const { pi, pr, stop } = setup(registered, time.env, time.now);
  try {
    pi.last().resolve(unavailable);
    await settle();
    pr.open();
    time.hide(true);
    await time.advance(120_000);
    assert.equal(pi.requests.length, 1);
    time.hide(false);
    pr.edit();
    assert.equal(time.pending(), 0);
    await time.advance(120_000);
    assert.equal(pi.requests.length, 1);
    pr.cancel();
    await time.advance(60_000);
    assert.equal(pi.requests.length, 2);
    pi.last().resolve(unavailable);
    await settle();
    pr.close();
    assert.equal(time.pending(), 0);
    await time.advance(120_000);
    assert.equal(pi.requests.length, 2);
  } finally {
    stop();
  }
});

for (const end of ["remove", "change", "select", "stop"] as const) {
  test(`a late recovery response cannot revive polling after ${end}`, async () => {
    const time = clock();
    const { pi, pr, stop } = setup(registered, time.env, time.now);
    try {
      pi.last().resolve(unavailable);
      await settle();
      pr.open();
      await time.advance(60_000);
      assert.equal(pi.requests.length, 2);
      const retry = pi.last();
      if (end === "remove") pr.observe("w1", "s1", null, false);
      if (end === "change") {
        const other = { ...registered, url: "https://github.com/example/repo/pull/43" };
        pr.observe("w1", "s1", other, false);
        pi.last().resolve({ ...facts("closed"), link: other });
        await settle();
      }
      if (end === "select") pr.observe("w1", "s2", registered, false);
      if (end === "stop") stop();
      assert.equal(retry.signal.aborted, true);
      const current = pr.getState();
      retry.resolve(unavailable);
      await settle();
      assert.deepEqual(pr.getState(), current, "obsolete error cannot replace current state");
      assert.equal(time.pending(), 0);
      const sent = pi.requests.length;
      await time.advance(600_000);
      assert.equal(pi.requests.length, sent);
    } finally {
      stop();
    }
  });
}

test("closed details do not poll; opening reuses a fresh or in-flight focus result and refreshes stale facts", async () => {
  const time = clock();
  const { pi, pr, stop } = setup(registered, time.env, time.now);
  pi.last().resolve(facts("open"));
  await settle();
  await time.advance(120_000);
  assert.equal(pi.requests.length, 1, "no polling while the popover is closed");

  time.focus();
  assert.equal(pi.requests.length, 2);
  pr.open();
  assert.equal(pi.requests.length, 2, "opening joins the in-flight focus read");
  pi.last().resolve(facts("draft"));
  await settle();
  assert.equal(pr.getState().value?.pullRequest?.state, "draft");
  pr.close();
  await time.advance(59_999);
  pr.open();
  assert.equal(pi.requests.length, 2, "opening uses the recent focus result");
  pr.close();
  await time.advance(1);
  pr.open();
  assert.equal(pi.requests.length, 3, "a minute-old result refreshes on open");
  assert.equal(
    pr.getState().value?.pullRequest?.state,
    "draft",
    "stale details stay visible during refresh",
  );
  await time.advance(120_000);
  assert.equal(pi.requests.length, 3, "polling does not interrupt a slow refresh");
  stop();
});

test("only visible, active PR details poll; closing, editing, terminal states and stopping cancel polling", async () => {
  const time = clock();
  const { pi, pr, stop } = setup(registered, time.env, time.now);
  pi.last().resolve(facts("open"));
  await settle();
  pr.open();
  await time.advance(60_000);
  assert.equal(pi.requests.length, 2, "open PR details poll");
  pi.last().resolve(facts("draft"));
  await settle();
  time.hide(true);
  await time.advance(60_000);
  assert.equal(pi.requests.length, 2, "hidden pages do not poll");
  time.hide(false);
  await time.advance(60_000);
  assert.equal(pi.requests.length, 3, "draft details poll once visible");
  pi.last().resolve(facts("open"));
  await settle();
  pr.edit();
  await time.advance(60_000);
  assert.equal(pi.requests.length, 3, "editing does not poll");
  pr.cancel();
  await time.advance(60_000);
  assert.equal(pi.requests.length, 4, "returning to details resumes polling");
  pi.last().resolve(facts("merged"));
  await settle();
  await time.advance(120_000);
  assert.equal(pi.requests.length, 4, "merged PRs stop polling");
  time.focus();
  assert.equal(pi.requests.length, 5, "focus still refreshes terminal PRs");
  pi.last().resolve(facts("closed"));
  await settle();
  await time.advance(120_000);
  assert.equal(pi.requests.length, 5, "closed PRs do not poll");

  time.focus();
  pi.last().resolve(facts("open"));
  await settle();
  pr.close();
  await time.advance(60_000);
  assert.equal(pi.requests.length, 6, "closing cancels the pending poll");
  pr.open();
  pi.last().resolve(facts("open"));
  await settle();
  const sent = pi.requests.length;
  stop();
  time.focus();
  await time.advance(120_000);
  assert.equal(pi.requests.length, sent, "stopping cancels polling and focus reads");
});

test("a late response from another session cannot make current facts fresh", async () => {
  const time = clock();
  const { pi, pr, stop } = setup(registered, time.env, time.now);
  const old = pi.last();
  pr.observe("w1", "s2", registered, false);
  pi.last().resolve(facts("draft"));
  await settle();
  await time.advance(60_000);
  old.resolve(facts("merged"));
  await settle();
  pr.open();
  assert.equal(pr.getState().value?.pullRequest?.state, "draft");
  assert.equal(pi.requests.length, 3, "the other session's late response did not reset freshness");
  stop();
});

test("Find from branch with nothing found reports it exactly once", async () => {
  const { pi, pr, notes } = setup(undefined);
  pr.open();
  const finding = pr.discover();
  assert.equal(pr.getState().finding, true);
  assert.equal(pr.getState().busy, true);
  assert.deepEqual(pi.last().action, { action: "discover" });
  pi.last().resolve(unlinked);
  assert.deepEqual(await finding, { _tag: "not-found" });
  // A later background search of the same absence stays silent.
  pr.observe("w1", "s1", undefined, true);
  pr.observe("w1", "s1", undefined, false);
  pi.last().resolve(unlinked);
  await settle();
  assert.deepEqual(notes.info, ["No open PR found for this branch."]);
  assert.deepEqual(notes.error, []);
  assert.equal(pr.getState().surface, "link-form", "the form stays for a manual link");
  assert.equal(pr.getState().finding, false);
});

test("a failed change keeps the saved link with the reason and the edit open", async () => {
  const { pi, pr, notes, closes } = setup(registered);
  pi.last().resolve(linked);
  await settle();
  pr.open();
  pr.edit();
  const saving = pr.link("https://github.com/example/repo/pull/7");
  pi.last().reject(new Error("GitHub is unreachable"));
  assert.deepEqual(await saving, { _tag: "failed", reason: "GitHub is unreachable" });
  const { value, surface, busy } = pr.getState();
  assert.equal(value?.link?.url, URL);
  assert.equal(value?.error, "GitHub is unreachable");
  assert.equal(surface, "editing");
  assert.equal(busy, false);
  assert.deepEqual(notes.error, ["GitHub is unreachable"]);
  assert.equal(closes(), 0);
});

test("background reads never reset an edit in progress", async () => {
  const { pi, pr } = setup(registered);
  pi.last().resolve(linked);
  await settle();
  pr.open();
  pr.edit();
  pr.observe("w1", "s1", registered, true);
  pi.last().resolve(linked);
  await settle();
  pr.observe("w1", "s1", registered, false);
  pi.last().reject(new Error("rate limited"));
  await settle();
  assert.equal(pr.getState().surface, "editing");
  assert.equal(pr.getState().value?.link?.url, URL, "an unreadable PR keeps the saved link");
  pr.cancel();
  assert.equal(pr.getState().surface, "details");
});

test("an unreadable first read still shows the registry's link", async () => {
  const { pi, pr } = setup(registered);
  pi.last().reject(new Error("offline"));
  await settle();
  assert.equal(pr.getState().value?.link?.url, URL);
  assert.equal(pr.getState().value?.pullRequest, null);
  pr.open();
  assert.equal(pi.requests.length, 2, "opening retries when no read has succeeded");
  pr.close();
  pr.open();
  assert.equal(pi.requests.length, 2, "reopening does not replace the retry in flight");
});

test("a blank URL, or one sent while another change is in flight, sends nothing", async () => {
  const { pi, pr } = setup(undefined);
  pr.open();
  const sent = pi.requests.length;
  assert.deepEqual(await pr.link(""), { _tag: "refused" });
  assert.deepEqual(await pr.link("   "), { _tag: "refused" });
  assert.equal(pi.requests.length, sent);

  const finding = pr.discover();
  assert.deepEqual(await pr.link(URL), { _tag: "refused" });
  assert.equal(pi.requests.length, sent + 1, "only the discovery was sent");
  pi.last().resolve(linked);
  assert.equal((await finding)._tag, "saved", "the change in flight was not superseded");
});

test("a session selected mid-turn is read once; its work stopping reads it again", async () => {
  const { pi, pr } = setup(undefined);
  // The hook used to tell the module "work started" on selection; that aborted the first read
  // and sent a second. The module now knows a selection from an edge.
  pr.observe("w1", "s2", registered, true);
  await settle();
  assert.equal(pi.requests.length, 1, "selecting a working, linked session reads exactly once");
  pi.last().resolve(linked);
  await settle();
  pr.observe("w1", "s2", registered, true);
  assert.equal(pi.requests.length, 1, "an unchanged snapshot reads nothing");
  pr.observe("w1", "s2", registered, false);
  assert.equal(pi.requests.length, 2, "the turn ending within the session reads its facts again");
});

test("only a session whose own work stopped is searched, and only once", async () => {
  const { pi, pr } = setup(undefined);
  pr.observe("w1", "s2", undefined, true);
  pr.observe("w1", "s3", undefined, false);
  assert.equal(pi.requests.length, 0, "leaving a working session for an idle one searches neither");
  pr.observe("w1", "s3", undefined, true);
  pr.observe("w1", "s3", undefined, false);
  assert.equal(pi.requests.length, 1, "the idle one is searched when its own work stops");
  pr.observe("w1", "s3", undefined, false);
  assert.equal(pi.requests.length, 1, "repeating the snapshot does not search again");
  pr.observe("w1", "s4", null, true);
  pr.observe("w1", "s4", null, false);
  assert.equal(pi.requests.length, 1, "a session whose link was removed is never searched");
});
