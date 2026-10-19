import assert from "node:assert/strict";
import { test } from "node:test";
import type {
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
    resolve: (body: SessionPullRequest) => void;
    reject: (error: Error) => void;
  }[] = [];
  return {
    requests,
    api: (_workspaceId: string, _sessionId: string, action: SessionPullRequestAction | undefined) =>
      new Promise<SessionPullRequest>((resolve, reject) =>
        requests.push({ action, resolve, reject }),
      ),
    last: () => requests[requests.length - 1]!,
  };
}

/** Observes session s1 with the registry link the catalog reports for it. */
function setup(link: SessionPullRequestLink | null | undefined) {
  const pi = server();
  const notes: { error: string[]; info: string[] } = { error: [], info: [] };
  let closes = 0;
  const pr = createSessionPullRequest({
    api: pi.api,
    notify: { error: (m) => notes.error.push(m), info: (m) => notes.info.push(m) },
    closed: () => closes++,
    environment,
  });
  pr.start();
  pr.observe("w1", "s1", link, false);
  return { pi, pr, notes, closes: () => closes };
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
