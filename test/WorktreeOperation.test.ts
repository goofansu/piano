import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  ClientMessage,
  ServerMessage,
  WorktreeDiscovery,
  WorktreeFacts,
} from "../shared/wire.ts";
import { createClient } from "../web/src/lib/client.ts";
import {
  createWorktreeOperation,
  filterWorktrees,
  RECEIPT_TIMEOUT_MS,
  type WorktreeOperationState,
  worktreeLabel,
  worktreesView,
} from "../web/src/lib/worktreeOperation.ts";
import type { ConnectionHandlers } from "../web/src/lib/ws.ts";
import { initialState } from "../web/src/store.ts";

const NO_RECEIPT =
  "No creation/selection receipt. Refresh discovery and inspect the checkout before retrying; it may already exist.";
const CONNECTION_LOST =
  "Connection lost. Refresh discovery after reconnecting before retrying; the operation may have changed the checkout.";

const discovered = (observedAt: string): WorktreeDiscovery => ({
  status: "ready",
  observedAt,
  currentPath: "/repo",
  worktrees: [{ path: "/repo", branch: "main", detached: false, prunable: false }],
});

/** A connected page client over a fake connection, the test playing the server, and one picker operation on it. */
function picker() {
  const sent: ClientMessage[] = [];
  let handlers: ConnectionHandlers | undefined;
  const client = createClient({
    initial: initialState,
    connect: (h) => {
      handlers = h;
      return {
        send: (m) => {
          sent.push(m);
          return "sent";
        },
        close: () => {},
      };
    },
    notify: () => {},
    lastDirectory: { read: () => null, write: () => {} },
  });
  client.start();
  handlers!.onStatus(true);
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  let ids = 0;
  const opened: string[] = [];
  const operation = createWorktreeOperation({
    client,
    newRequestId: () => `r${++ids}`,
    timers: {
      setTimeout: (run, ms) => {
        assert.equal(ms, RECEIPT_TIMEOUT_MS);
        timers.set(++nextTimer, run);
        return nextTimer;
      },
      clearTimeout: (timer) => timers.delete(timer as number),
    },
    ready: (path) => opened.push(path),
  });
  const stop = operation.start();
  const server = (m: ServerMessage) => handlers!.onMessage(m);
  const commands = () => sent.filter((m) => m._tag !== "models" && m._tag !== "trust");
  return {
    client,
    server,
    operation,
    state: (): WorktreeOperationState => operation.getState(),
    commands,
    last: () => commands().at(-1),
    opened,
    timers,
    stop,
    connection: (connected: boolean) => handlers!.onStatus(connected),
    answer: (folder: string, discovery: WorktreeDiscovery) =>
      server({
        _tag: "worktrees",
        folder,
        requestId: sent.filter((m) => m._tag === "worktrees").findLast((m) => m.folder === folder)
          ?.requestId,
        discovery,
      }),
    receipt: (
      requestId: string,
      result: { status: "ready"; path: string } | { status: "error"; detail: string },
    ) =>
      server({
        _tag: "worktree_result",
        requestId,
        result:
          result.status === "ready" ? { ...result, folder: "/repo", branch: "feature" } : result,
      } as ServerMessage),
    elapse: () => {
      const due = [...timers.values()];
      timers.clear();
      for (const run of due) run();
    },
  };
}

const failure = (state: WorktreeOperationState) =>
  state.request.status === "failed" ? state.request.detail : undefined;
const unconfirmed = (state: WorktreeOperationState) =>
  state.request.status === "failed" && state.request.unconfirmed;

test("creating sends one command and is pending until its own receipt opens the checkout", () => {
  const p = picker();
  p.operation.open("/repo");
  p.answer("/repo", discovered("t1"));
  p.operation.create("  feature ", false);
  assert.deepEqual(p.last(), {
    _tag: "create_worktree",
    requestId: "r1",
    folder: "/repo",
    branch: "feature",
    hooks: false,
  });
  assert.deepEqual(p.state().request, { status: "pending", requestId: "r1", kind: "create" });

  const before = p.commands().length;
  p.operation.create("other", true);
  p.operation.select("/repo-other");
  assert.equal(p.commands().length, before, "never sends again while pending");

  p.receipt("stale", { status: "ready", path: "/elsewhere" });
  p.receipt("stale", { status: "error", detail: "x" });
  assert.equal(p.state().request.status, "pending", "another request's receipt is ignored");
  assert.deepEqual(p.opened, []);

  p.receipt("r1", { status: "ready", path: "/repo-feature" });
  assert.deepEqual(p.opened, ["/repo-feature"]);
  assert.deepEqual(p.state().request, { status: "idle" });
  assert.equal(p.timers.size, 0, "the receipt clears the timeout");
});

test("selecting sends one add_worktree; an error receipt fails with Worktrunk's detail", () => {
  const p = picker();
  p.operation.open("/repo");
  p.operation.select("/repo-other");
  assert.deepEqual(p.last(), {
    _tag: "add_worktree",
    requestId: "r1",
    folder: "/repo",
    path: "/repo-other",
  });
  p.receipt("r1", { status: "error", detail: "branch exists" });
  assert.equal(failure(p.state()), "branch exists");
  assert.equal(unconfirmed(p.state()), false, "an error before Worktrunk ran changed nothing");
  assert.deepEqual(p.opened, []);
  p.receipt("r1", { status: "ready", path: "/late" });
  assert.deepEqual(p.opened, [], "a settled request opens nothing");
});

test("losing the connection while pending fails with reconnect guidance and is never retried", () => {
  const p = picker();
  p.operation.open("/repo");
  p.operation.select("/repo-other");
  p.connection(false);
  assert.equal(failure(p.state()), CONNECTION_LOST);
  assert.equal(unconfirmed(p.state()), true);
  p.connection(true);
  p.elapse();
  assert.equal(failure(p.state()), CONNECTION_LOST, "a settled failure is not overwritten");
  assert.equal(
    p.commands().filter((m) => m._tag === "add_worktree").length,
    1,
    "the operation is not resent",
  );
});

test("a pending operation with no receipt times out after 75 seconds", () => {
  const p = picker();
  p.operation.open("/repo");
  p.operation.create("feature", false);
  assert.equal(p.timers.size, 1);
  p.elapse();
  assert.equal(failure(p.state()), NO_RECEIPT);
  assert.equal(unconfirmed(p.state()), true);
  p.receipt("r1", { status: "ready", path: "/late" });
  assert.deepEqual(p.opened, [], "a receipt after the timeout opens nothing");
});

test("nothing starts while disconnected, without a folder or without a branch", () => {
  const p = picker();
  p.operation.create("feature", false);
  p.operation.select("/x");
  p.operation.open("/repo");
  p.operation.create("   ", false);
  p.connection(false);
  p.operation.create("feature", false);
  p.operation.refresh();
  assert.deepEqual(
    p.commands().map((m) => m._tag),
    ["worktrees"],
    "only the discovery sent on open while connected",
  );
  assert.equal(p.state().refreshing, false, "a request lost with the connection is not awaited");
});

test("refreshing lasts until this picker's discovery answers; refresh keeps a failure on screen", () => {
  const p = picker();
  p.operation.open("/repo");
  assert.equal(p.last()?._tag, "worktrees");
  assert.equal(p.state().refreshing, true);
  p.answer("/elsewhere", discovered("other"));
  assert.equal(p.state().refreshing, true, "another folder's answer is not this one");
  p.answer("/repo", discovered("t1"));
  assert.equal(p.state().refreshing, false);
  assert.equal(p.state().discovery?.observedAt, "t1");

  p.operation.create("feature", false);
  p.elapse();
  p.operation.refresh();
  assert.equal(p.state().refreshing, true);
  assert.equal(failure(p.state()), NO_RECEIPT);
  p.operation.dismiss();
  assert.deepEqual(p.state().request, { status: "idle" });
});

test("reopen keeps refreshing until the new discovery answers", () => {
  const p = picker();
  p.operation.open("/repo");
  p.answer("/repo", discovered("first"));
  p.operation.create("feature", false);
  p.elapse();
  // Closed and opened again on the same folder: its earlier answer is still known.
  p.operation.open("/repo");
  assert.deepEqual(p.state().request, { status: "idle" }, "reopening forgets the failure");
  assert.equal(p.state().refreshing, true);
  assert.equal(p.state().discovery?.observedAt, "first", "the last observation stays visible");
  p.answer("/repo", discovered("second"));
  assert.equal(p.state().refreshing, false);
  assert.equal(p.state().discovery?.observedAt, "second");
});

test("a remounted picker ignores the previous picker's discovery on the same connection", () => {
  const p = picker();
  p.operation.open("/repo");
  const first = p.last();
  assert.ok(first?._tag === "worktrees");
  p.stop();

  const replacement = createWorktreeOperation({ client: p.client, ready: () => {} });
  const stop = replacement.start();
  replacement.open("/repo");
  const second = p.last();
  assert.ok(second?._tag === "worktrees");
  p.server({ ...first, discovery: discovered("old") });
  assert.equal(replacement.getState().refreshing, true, "A cannot settle B after remount");
  assert.equal(replacement.getState().discovery, undefined);
  p.server({ ...second, discovery: discovered("fresh") });
  assert.equal(replacement.getState().refreshing, false);
  assert.equal(replacement.getState().discovery?.observedAt, "fresh");
  p.server({ ...first, discovery: discovered("old") });
  assert.equal(replacement.getState().discovery?.observedAt, "fresh", "late A cannot overwrite B");
  stop();
});

test("overlapping refreshes coalesce behind the active discovery", () => {
  const p = picker();
  p.operation.open("/repo");
  p.operation.refresh();
  p.operation.refresh();
  assert.equal(p.commands().length, 1, "B cannot overtake A: only A is sent");
  const refreshing: boolean[] = [];
  p.operation.subscribe(() => refreshing.push(p.state().refreshing));
  p.answer("/repo", discovered("first"));
  assert.equal(p.commands().length, 2, "one trailing B is sent after A settles");
  assert.equal(p.state().refreshing, true);
  assert.ok(refreshing.every(Boolean), "A never falsely completes the queued refresh");
  p.answer("/repo", discovered("second"));
  assert.equal(p.state().refreshing, false);
  assert.equal(p.state().discovery?.observedAt, "second");
  assert.equal(p.commands().length, 2);
});

test("queued discoveries survive folder switches and reopen, including error answers", () => {
  const p = picker();
  p.operation.open("/repo");
  p.operation.open("/other");
  p.operation.open("/repo");
  assert.equal(p.commands().length, 2);
  p.answer("/repo", { status: "error", observedAt: "failed", detail: "busy" });
  assert.equal(p.commands().length, 3);
  const trailing = p.last();
  assert.ok(trailing?._tag === "worktrees");
  assert.equal(trailing.folder, "/repo");
  assert.equal(p.state().refreshing, true);
  p.answer("/other", discovered("other"));
  assert.equal(p.state().discovery?.observedAt, "failed");
  assert.equal(p.state().refreshing, true);
  p.answer("/repo", discovered("fresh"));
  assert.equal(p.state().discovery?.observedAt, "fresh");
  assert.equal(p.state().refreshing, false);
});

test("disconnect drops active and queued discoveries; reopening requests afresh", () => {
  const p = picker();
  p.operation.open("/repo");
  p.operation.refresh();
  p.operation.create("feature", false);
  p.connection(false);
  assert.equal(p.state().refreshing, false);
  assert.equal(p.timers.size, 0);
  const before = p.commands().length;
  p.connection(true);
  assert.equal(p.commands().length, before, "neither discovery nor mutation is replayed");
  p.operation.open("/repo");
  assert.equal(p.commands().length, before + 1);
  p.answer("/repo", discovered("reconnected"));
  assert.equal(p.state().refreshing, false);
  assert.equal(p.commands().length, before + 1, "old trailing intent was discarded");
});

test("stopping drops the pending timeout", () => {
  const p = picker();
  p.operation.open("/repo");
  p.operation.create("feature", false);
  p.stop();
  assert.equal(p.timers.size, 0);
});

test("worktrees filter literally by label or path, in discovery order", () => {
  const worktrees: WorktreeFacts[] = [
    { path: "/r/main", branch: "main" },
    { path: "/r/feature-x", branch: "feat/search" },
    { path: "/r/detached", branch: null },
  ] as WorktreeFacts[];
  assert.deepEqual(
    filterWorktrees(worktrees, "  ").map((w) => w.path),
    ["/r/main", "/r/feature-x", "/r/detached"],
  );
  assert.deepEqual(
    filterWorktrees(worktrees, "SEARCH").map((w) => w.path),
    ["/r/feature-x"],
  );
  assert.deepEqual(
    filterWorktrees(worktrees, "detach").map((w) => w.path),
    ["/r/detached"],
  );
  assert.deepEqual(
    filterWorktrees(worktrees, "mn").map((w) => w.path),
    [],
    "no fuzzy matches",
  );
});

const folder = (discovery: WorktreeDiscovery) => ({ name: "repo", discovery });
const idle = (patch: Partial<WorktreeOperationState> = {}): WorktreeOperationState => ({
  folder: "/repo",
  discovery: undefined,
  refreshing: false,
  request: { status: "idle" },
  ...patch,
});
const form = { creating: false, branch: "", hooks: false, query: "" };
const twoWorktrees: WorktreeDiscovery = {
  status: "ready",
  observedAt: "own",
  currentPath: "/repo",
  worktrees: [
    { path: "/repo", branch: "main", detached: false, prunable: false },
    { path: "/repo-feature", branch: "feature", detached: false, prunable: false },
  ],
};

test("the sidebar snapshot stands in only until the picker's own discovery answers", () => {
  const snapshot = folder(discovered("snapshot"));
  const before = worktreesView({ state: idle(), folder: snapshot, connected: true, form });
  assert.equal(before.discovery?.observedAt, "snapshot");
  assert.equal(before.target, snapshot);
  const after = worktreesView({
    state: idle({ discovery: twoWorktrees }),
    folder: snapshot,
    connected: true,
    form: { ...form, query: "feat" },
  });
  assert.equal(after.discovery?.observedAt, "own");
  assert.deepEqual(
    after.visible.map((w) => w.path),
    ["/repo-feature"],
  );
  const closed = worktreesView({
    state: idle({ discovery: twoWorktrees }),
    folder: undefined,
    connected: true,
    form,
  });
  assert.equal(closed.target, undefined, "a closed folder has nothing to create in");
  assert.deepEqual(closed.visible, []);
});

test("creating is offered only once discovery found a Git repository", () => {
  for (const discovery of [
    { status: "non-git", observedAt: "t" },
    { status: "error", observedAt: "t", detail: "git exploded" },
  ] as const) {
    const view = worktreesView({
      state: idle({ discovery }),
      folder: folder(discovered("snapshot")),
      connected: true,
      form: { ...form, creating: true, branch: "feature", query: "feature" },
    });
    assert.equal(view.target, undefined);
    assert.equal(view.createFromQuery, undefined, `${discovery.status}: no create offer`);
    assert.equal(view.canSubmit, false);
    assert.deepEqual(view.visible, []);
  }
  const nonGit = worktreesView({
    state: idle({ discovery: { status: "non-git", observedAt: "t" } }),
    folder: folder(discovered("snapshot")),
    connected: true,
    form,
  });
  assert.equal(nonGit.emptyText, "Non-Git directory");
  const errored = worktreesView({
    state: idle({ discovery: { status: "error", observedAt: "t", detail: "git exploded" } }),
    folder: folder(discovered("snapshot")),
    connected: false,
    form,
  });
  assert.equal(errored.emptyText, "No worktree matches.");
  assert.deepEqual(errored.notices, {
    disconnected: "Disconnected — showing last observation.",
    discoveryError: "git exploded",
  });
  const ready = worktreesView({
    state: idle({ discovery: twoWorktrees }),
    folder: folder(discovered("snapshot")),
    connected: true,
    form: { ...form, query: "  nothing  " },
  });
  assert.equal(ready.createFromQuery, "nothing", "unmatched search text is offered, trimmed");
  assert.deepEqual(ready.notices, { disconnected: undefined, discoveryError: undefined });
});

test("one rule enables both the Create button and the submit", () => {
  const pending = { status: "pending", requestId: "r1", kind: "create" } as const;
  const cases: [string, Partial<WorktreeOperationState>, boolean, string, boolean][] = [
    ["ready", {}, true, "feature", true],
    ["blank branch", {}, true, "   ", false],
    ["disconnected", {}, false, "feature", false],
    ["pending", { request: pending }, true, "feature", false],
  ];
  for (const [name, patch, connected, branch, expected] of cases) {
    const { canSubmit }: { canSubmit: boolean } = worktreesView({
      state: idle({ discovery: twoWorktrees, ...patch }),
      folder: folder(twoWorktrees),
      connected,
      form: { ...form, creating: true, branch },
    });
    assert.equal(canSubmit, expected, name);
  }
  const refreshing = worktreesView({
    state: idle({ discovery: twoWorktrees, refreshing: true }),
    folder: folder(twoWorktrees),
    connected: true,
    form: { ...form, creating: true, branch: "feature" },
  });
  assert.equal(refreshing.busy, true, "refresh and selection wait for discovery");
  assert.equal(refreshing.canSubmit, true, "creating does not wait for a refresh");
});

test("failures name what failed; an unconfirmed one asks to rediscover and hides the raw error", () => {
  const failed = (unconfirmed: boolean, creating: boolean, hooks: boolean) =>
    worktreesView({
      state: idle({
        discovery: twoWorktrees,
        request: { status: "failed", detail: "boom\nline two", unconfirmed },
      }),
      folder: folder(twoWorktrees),
      connected: true,
      form: { ...form, creating, hooks, branch: "feature" },
    }).failure;
  assert.deepEqual(failed(false, true, true), {
    title: "Could not create the worktree",
    lines: ["boom\nline two"],
  });
  assert.equal(failed(false, false, false)?.title, "Could not open the worktree");
  assert.deepEqual(failed(true, true, false), {
    title: "Worktree operation not confirmed",
    lines: ["Refresh discovery before retrying."],
    details: "boom\nline two",
  });
  assert.deepEqual(failed(true, true, true)?.lines, [
    "Refresh discovery before retrying.",
    "For unapproved hooks, review and approve them in a terminal, or leave hooks off.",
  ]);
  assert.equal(failed(true, false, true)?.lines.length, 1, "the hooks hint is for creation only");
  assert.equal(
    worktreesView({ state: idle(), folder: undefined, connected: true, form }).failure,
    undefined,
  );
});

test("a detached worktree is labelled Detached HEAD and still found by its path", () => {
  const detached: WorktreeFacts = {
    path: "/work/repo.detached",
    branch: null,
    detached: true,
    prunable: false,
  };
  assert.equal(worktreeLabel(detached), "Detached HEAD");
  assert.deepEqual(filterWorktrees([detached], "detached head"), [detached]);
  assert.deepEqual(filterWorktrees([detached], "repo.detached"), [detached]);
});
