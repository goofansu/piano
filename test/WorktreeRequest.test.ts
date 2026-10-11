import assert from "node:assert/strict";
import { test } from "node:test";
import type { WorktreeFacts } from "../shared/wire.ts";
import { filterWorktrees, initialWorktreeRequest, transition, type WorktreeEvent, type WorktreeRequest } from "../web/src/lib/worktreeRequest.ts";

const create = (requestId: string): WorktreeEvent => ({ type: "start", requestId, intent: { kind: "create", folder: "/repo", branch: "feature", hooks: false } });
const select = (requestId: string): WorktreeEvent => ({ type: "start", requestId, intent: { kind: "select", folder: "/repo", path: "/repo-other" } });
const receipt = (requestId: string, result: { status: "ready"; path: string } | { status: "error"; detail: string }): WorktreeEvent => ({
  type: "receipt",
  receipt: { _tag: "worktree_result", requestId, result: result.status === "ready" ? { ...result, folder: "/repo", branch: "feature" } : result },
});
/** Runs events in order, returning the final state. */
const run = (...events: WorktreeEvent[]): WorktreeRequest => events.reduce((state, event) => transition(state, event).state, initialWorktreeRequest);
const failure = (state: WorktreeRequest) => state.request.status === "failed" ? state.request.detail : undefined;

test("starting sends one create or select command and is pending until its own receipt", () => {
  const created = transition(initialWorktreeRequest, create("a"));
  assert.deepEqual(created.command, { _tag: "create_worktree", requestId: "a", folder: "/repo", branch: "feature", hooks: false });
  assert.deepEqual(created.state.request, { status: "pending", requestId: "a", kind: "create" });
  assert.deepEqual(transition(initialWorktreeRequest, select("b")).command, { _tag: "add_worktree", requestId: "b", folder: "/repo", path: "/repo-other" });

  const done = transition(created.state, receipt("a", { status: "ready", path: "/repo-feature" }));
  assert.equal(done.ready, "/repo-feature");
  assert.deepEqual(done.state.request, { status: "idle" });
});

test("starting never sends again while a request is pending", () => {
  const pending = run(create("a"));
  for (const event of [create("b"), select("c")]) {
    const next = transition(pending, event);
    assert.equal(next.command, undefined);
    assert.equal(next.state, pending);
  }
});

test("a receipt for another request is ignored", () => {
  const pending = run(create("a"));
  for (const event of [receipt("stale", { status: "ready", path: "/elsewhere" }), receipt("stale", { status: "error", detail: "x" }), { type: "receipt", receipt: null } as const]) {
    const next = transition(pending, event);
    assert.equal(next.ready, undefined);
    assert.equal(next.state, pending);
  }
  assert.equal(transition(initialWorktreeRequest, receipt("a", { status: "ready", path: "/p" })).ready, undefined, "nothing pending, nothing opens");
});

test("an error receipt fails the request with Worktrunk's detail", () => {
  assert.equal(failure(run(create("a"), receipt("a", { status: "error", detail: "branch exists" }))), "branch exists");
});

test("losing the connection while pending fails with reconnect guidance and is never retried", () => {
  const next = transition(run(select("a")), { type: "disconnected" });
  assert.equal(next.command, undefined);
  assert.equal(failure(next.state), "Connection lost. Refresh discovery after reconnecting before retrying; the operation may have changed the checkout.");
  assert.deepEqual(transition(initialWorktreeRequest, { type: "disconnected" }).state, initialWorktreeRequest, "idle stays idle");
});

test("a pending request with no receipt times out", () => {
  assert.equal(failure(run(create("a"), { type: "timeout" })), "No creation/selection receipt. Refresh discovery and inspect the checkout before retrying; it may already exist.");
  assert.equal(failure(run(create("a"), { type: "disconnected" }, { type: "timeout" })), failure(run(create("a"), { type: "disconnected" })), "a settled failure is not overwritten");
});

test("rediscovery resets the operation and asks the folder again; refresh keeps a failure on screen", () => {
  for (const before of [run(create("a")), run(create("a"), { type: "timeout" })]) {
    const next = transition(before, { type: "rediscover", folder: "/repo" });
    assert.deepEqual(next.state, { request: { status: "idle" }, refreshing: true });
    assert.deepEqual(next.command, { _tag: "worktrees", folder: "/repo" });
  }
  const failed = run(create("a"), { type: "timeout" });
  const refreshed = transition(failed, { type: "refresh", folder: "/repo" });
  assert.equal(failure(refreshed.state), failure(failed));
  assert.equal(refreshed.state.refreshing, true);
  assert.equal(transition(refreshed.state, { type: "answered" }).state.refreshing, false);
  assert.equal(transition(initialWorktreeRequest, { type: "rediscover", folder: undefined }).command, undefined, "no folder, nothing to discover");
});

test("worktrees filter literally by label or path, in discovery order", () => {
  const worktrees: WorktreeFacts[] = [
    { path: "/r/main", branch: "main" },
    { path: "/r/feature-x", branch: "feat/search" },
    { path: "/r/detached", branch: null },
  ] as WorktreeFacts[];
  assert.deepEqual(filterWorktrees(worktrees, "  ").map(w => w.path), ["/r/main", "/r/feature-x", "/r/detached"]);
  assert.deepEqual(filterWorktrees(worktrees, "SEARCH").map(w => w.path), ["/r/feature-x"]);
  assert.deepEqual(filterWorktrees(worktrees, "detach").map(w => w.path), ["/r/detached"]);
  assert.deepEqual(filterWorktrees(worktrees, "mn").map(w => w.path), [], "no fuzzy matches");
});
