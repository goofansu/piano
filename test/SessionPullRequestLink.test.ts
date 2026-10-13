import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionPullRequest, SessionPullRequestAction } from "../shared/wire.ts";
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
const unlinked: SessionPullRequest = { link: null, pullRequest: null, discovery: true };
const linked: SessionPullRequest = {
  link: { url: URL, source: "manual" },
  pullRequest: null,
  discovery: true,
};

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

function setup() {
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
  pr.observe("w1", "s1");
  return { pi, pr, notes, closes: () => closes };
}

test("opening while unlinked offers the link form; a link found in the background closes it", async () => {
  const { pi, pr, closes } = setup();
  pi.last().resolve(unlinked);
  await settle();
  pr.open();
  assert.equal(pr.getState().surface, "link-form");

  pr.refreshSoon(0);
  pi.last().resolve(linked);
  await settle();
  assert.equal(pr.getState().surface, "closed");
  assert.equal(closes(), 1, "whoever owns the panel learns it closed");
  pr.open();
  assert.equal(pr.getState().surface, "details", "reopening shows the link");
});

test("Find from branch with nothing found reports it exactly once", async () => {
  const { pi, pr, notes } = setup();
  pi.last().resolve(unlinked);
  await settle();
  pr.open();
  const finding = pr.discover();
  assert.equal(pr.getState().finding, true);
  assert.equal(pr.getState().busy, true);
  assert.deepEqual(pi.last().action, { action: "discover" });
  pi.last().resolve(unlinked);
  assert.deepEqual(await finding, { _tag: "not-found" });
  // A later background read of the same absence stays silent.
  pr.refreshSoon(0);
  pi.last().resolve(unlinked);
  await settle();
  assert.deepEqual(notes.info, ["No open PR found for this branch."]);
  assert.deepEqual(notes.error, []);
  assert.equal(pr.getState().surface, "link-form", "the form stays for a manual link");
  assert.equal(pr.getState().finding, false);
});

test("a failed change keeps the saved link with the reason and the edit open", async () => {
  const { pi, pr, notes, closes } = setup();
  pi.last().resolve(linked);
  await settle();
  pr.open();
  pi.last().resolve(linked); // opening reads the details afresh
  await settle();
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
  const { pi, pr } = setup();
  pi.last().resolve(linked);
  await settle();
  pr.open();
  pi.last().resolve(linked);
  await settle();
  pr.edit();
  pr.refreshSoon(0);
  pi.last().resolve({ ...linked, discovery: false });
  await settle();
  pr.refreshSoon(0);
  pi.last().reject(new Error("rate limited"));
  await settle();
  assert.equal(pr.getState().surface, "editing");
  assert.equal(pr.getState().value?.link?.url, URL, "an unreadable PR keeps the saved link");
  pr.cancel();
  assert.equal(pr.getState().surface, "details");
});

test("a blank URL, or one sent while another change is in flight, sends nothing", async () => {
  const { pi, pr } = setup();
  pi.last().resolve(unlinked);
  await settle();
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
