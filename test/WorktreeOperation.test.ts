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
      return { send: (m) => sent.push(m), close: () => {} };
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
    operation,
    state: (): WorktreeOperationState => operation.getState(),
    commands,
    last: () => commands().at(-1),
    opened,
    timers,
    stop,
    connection: (connected: boolean) => handlers!.onStatus(connected),
    answer: (folder: string, discovery: WorktreeDiscovery) =>
      server({ _tag: "worktrees", folder, discovery }),
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
  assert.deepEqual(p.last(), { _tag: "worktrees", folder: "/repo" });
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

test("overlapping discoveries refresh until the last one answers", () => {
  const p = picker();
  p.operation.open("/repo");
  p.operation.refresh();
  p.answer("/repo", discovered("first"));
  assert.equal(p.state().refreshing, true);
  p.answer("/repo", discovered("second"));
  assert.equal(p.state().refreshing, false);
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
