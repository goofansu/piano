import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderView, SessionState } from "../shared/wire.ts";
import { sessionNotices } from "../web/src/lib/sessionNotices.ts";
import {
  type AppState,
  initialState,
  type PendingCreate,
  type SessionView,
} from "../web/src/store.ts";

const folder = (discovery: FolderView["discovery"]): FolderView => ({
  path: "/repo",
  name: "repo",
  discovery,
  worktrees: [
    {
      workspace: { id: "ws:/repo", folder: "/repo", path: "/repo" },
      trust: { required: true, trusted: false },
      branch: "main",
      path: "/repo",
      root: true,
      status: "current",
    },
  ],
});
const ready = folder({ status: "ready", observedAt: "", currentPath: "/repo", worktrees: [] });
const session = (state: Partial<SessionState> = {}): SessionView => ({
  cwd: "/repo",
  sessionId: "s1",
  hosted: true,
  cursor: null,
  state: { sessionId: "s1", ...state } as SessionState,
  messages: [],
  dialogs: [],
});
const at = (state: Partial<SessionState> = {}, extra: Partial<AppState> = {}): AppState => ({
  ...initialState,
  connected: true,
  selectionId: "sel",
  view: { kind: "session" },
  folders: [ready],
  session: session(state),
  ...extra,
});
const notices = (s: AppState) => sessionNotices(s, false);
const ids = (s: AppState) => notices(s).map((n) => n.id);
const find = (s: AppState, id: string) => notices(s).find((n) => n.id === id);

test("a quiet session has no notices", () => {
  assert.deepEqual(ids(at()), []);
});

test("a release, a requested stop or a clean exit is quiet; a stop that may have cut work short is a destructive banner", () => {
  assert.deepEqual(ids(at({ closure: { _tag: "released", detail: "idle" } })), []);
  assert.deepEqual(ids(at({ closure: { _tag: "stopped", detail: "archived while working" } })), []);
  assert.deepEqual(
    ids(at({ closure: { _tag: "exited", code: 0, detail: "exited with code 0" } })),
    [],
  );

  const cut = find(
    at({ closure: { _tag: "released_during_work", detail: "released while working" } }),
    "closure",
  );
  assert.equal(cut?.placement, "banner");
  assert.equal(cut?.tone, "destructive");
  assert.equal(cut?.title, "Pi stopped: released while working.");
  assert.deepEqual(cut?.details, [
    "Interrupted operations are not resumed. Inspect the checkout before continuing.",
  ]);
  assert.equal(
    find(at({ closure: { _tag: "exited", code: 1, detail: "exited with code 1" } }), "closure")
      ?.tone,
    "destructive",
  );
});

test("a failed state and stats refresh is one warning that carries both reasons", () => {
  const both = notices(
    at({ stateRefreshError: "state timed out", statsRefreshError: "stats timed out" }),
  );
  assert.equal(both.length, 1);
  assert.equal(both[0]?.tone, "warning");
  assert.equal(both[0]?.title, "Unable to refresh session details. Some information may be stale.");
  assert.deepEqual(both[0]?.details, ["state timed out", "stats timed out"]);
  assert.deepEqual(find(at({ statsRefreshError: "stats timed out" }), "refresh-error")?.details, [
    "stats timed out",
  ]);
});

test("a Git discovery error offers a registry refresh", () => {
  const git = find(
    at(
      {},
      {
        folders: [
          folder({ status: "error", observedAt: "", detail: "fatal: not a git repository" }),
        ],
      },
    ),
    "git-unavailable",
  );
  assert.equal(git?.title, "Git status unavailable.");
  assert.deepEqual(git?.details, ["fatal: not a git repository"]);
  assert.deepEqual(git?.action, { label: "Refresh", command: { _tag: "registry" } });
});

test("banners come before status lines, in a fixed order", () => {
  const s = at({
    closure: { _tag: "failed", detail: "exit unobserved" },
    projectionError: "projection failed",
    stateRefreshError: "state failed",
    dialogResolution: {
      id: "d1",
      generation: "g",
      reason: "expired",
      delivery: "not-sent",
      detail: "no answer in time",
    },
    submission: { id: 1, outcome: "handled" },
  });
  assert.deepEqual(ids(s), [
    "closure",
    "projection-error",
    "refresh-error",
    "dialog-resolution",
    "submission",
  ]);
  assert.equal(find(s, "dialog-resolution")?.title, "Dialog expired: no answer in time");
});

test("a delivered cancellation is a compact warning, without hiding pending or uncertain delivery", () => {
  for (const delivery of ["pending", "written", "uncertain", "not-sent"] as const) {
    const line = find(
      at({
        dialogResolution: {
          id: "d1",
          generation: "g",
          reason: "cancelled",
          delivery,
          detail: "Transport outcome",
        },
      }),
      "dialog-resolution",
    );
    assert.equal(line?.placement, "status");
    if (delivery === "written") {
      assert.equal(line?.tone, "warning");
      assert.equal(line?.title, "Question cancelled");
      assert.deepEqual(line?.details, []);
    } else {
      assert.match(line?.title ?? "", /Transport outcome/);
      assert.notEqual(line?.title, "Question cancelled");
    }
  }
});

test("an answer card owns its delivery feedback without a duplicate status line", () => {
  for (const delivery of ["pending", "written", "uncertain"] as const) {
    const s = at({
      dialogResolution: {
        id: "d1",
        generation: "g",
        reason: "answered",
        delivery,
        detail: "transport detail",
        answer: { title: "Which checks?", value: "Full suite" },
      },
    });
    assert.equal(find(s, "dialog-resolution"), undefined);
  }
});

test("an uncertain first message explains with the browser's own detail before Pi's", () => {
  const input: PendingCreate = {
    selectionId: "create",
    cwd: "/repo",
    text: "hi",
    outcome: "uncertain",
    detail: "connection lost while sending",
  };
  const s = at(
    { submission: { id: 1, outcome: "uncertain", detail: "Pi did not acknowledge" } },
    { pendingCreate: input },
  );
  const line = find(s, "submission");
  assert.equal(line?.placement, "status");
  assert.equal(line?.tone, "warning");
  assert.match(line?.title ?? "", /^Delivery uncertain — inspect the session list/);
  assert.deepEqual(line?.details, ["connection lost while sending"]);

  const piOnly = find(
    at({ submission: { id: 1, outcome: "uncertain", detail: "Pi did not acknowledge" } }),
    "submission",
  );
  assert.deepEqual(piOnly?.details, ["Pi did not acknowledge"]);
  assert.equal(
    find(at({ submission: { id: 1, outcome: "started" } }), "submission"),
    undefined,
    "running work needs no sentence",
  );
});

test("a first message that never reached Pi warns, whatever stopped it", () => {
  const input: PendingCreate = {
    selectionId: "create",
    cwd: "/repo",
    text: "hi",
    outcome: "starting",
  };
  // The selection was rejected before Pi reported any submission.
  const rejected = find(
    at(
      {},
      {
        session: null,
        selectionId: null,
        selectionFailure: { cwd: "/repo", sessionId: null, message: "Directory not trusted" },
        pendingCreate: { ...input, outcome: "rejected", detail: "Directory not trusted" },
      },
    ),
    "submission",
  );
  assert.equal(rejected?.tone, "warning");
  assert.equal(rejected?.title, "Message rejected.");
  assert.deepEqual(rejected?.details, ["Directory not trusted"]);

  // The connection dropped while the first message was starting.
  const lost = find(
    at(
      {},
      {
        connected: false,
        session: null,
        selectionId: null,
        pendingCreate: {
          ...input,
          outcome: "uncertain",
          detail: "Connection lost before delivery was confirmed.",
        },
      },
    ),
    "submission",
  );
  assert.equal(lost?.tone, "warning");
  assert.match(lost?.title ?? "", /^Delivery uncertain — inspect the session list/);
  assert.deepEqual(lost?.details, ["Connection lost before delivery was confirmed."]);
});

test("a handled command is a quiet line whether the browser or Pi reports it", () => {
  const input: PendingCreate = {
    selectionId: "create",
    cwd: "/repo",
    text: "/x",
    outcome: "handled",
  };
  for (const s of [
    at({}, { pendingCreate: input }),
    at({ submission: { id: 1, outcome: "handled" } }),
  ]) {
    const line = find(s, "submission");
    assert.equal(line?.tone, "quiet");
    assert.equal(line?.title, "Command handled.");
  }
});

test("Pi's submission speaks once the browser's record is gone", () => {
  const submitting = find(at({ submission: { id: 2, outcome: "submitting" } }), "submission");
  assert.equal(submitting?.tone, "quiet");
  assert.equal(submitting?.title, "Submitting — waiting for Pi.");
  const rejected = find(
    at({ submission: { id: 2, outcome: "rejected", detail: "busy" } }),
    "submission",
  );
  assert.equal(rejected?.tone, "warning");
  assert.equal(rejected?.title, "Message rejected.");
  assert.deepEqual(rejected?.details, ["busy"]);
  assert.match(
    find(at({ submission: { id: 2, outcome: "uncertain" } }), "submission")?.title ?? "",
    /^Delivery uncertain — inspect the session and queue/,
  );
});

test("an extension block appears only when it says something", () => {
  assert.equal(find(at({ extension: { statuses: [], widgets: [] } }), "extension"), undefined);
  const said = find(
    at({ extension: { statuses: [{ key: "lint", text: "clean" }], widgets: [] } }),
    "extension",
  );
  assert.deepEqual(said?.extension?.statuses, [{ key: "lint", text: "clean" }]);
  assert.ok(
    find(
      at({
        extension: { statuses: [], widgets: [], editorRequest: { id: "e1", text: "Try this" } },
      }),
      "extension",
    ),
  );
});

test("a missing checkout replaces the composer with a read-only notice", () => {
  const missing = find(at({ checkoutMissing: true }), "checkout-missing");
  assert.equal(missing?.placement, "composer");
  assert.equal(missing?.title, "Checkout removed · Read-only session");
  assert.equal(find(at(), "checkout-missing"), undefined);
});
