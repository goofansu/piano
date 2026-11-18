import assert from "node:assert/strict";
import { test } from "node:test";
import {
  projectDisplay,
  projectServerMessage,
  projectSessionEvent,
  projectSnapshot,
} from "../server/DisplayProjection.ts";
import type { ServerMessage, SessionState, Snapshot } from "../shared/wire.ts";

test("a written file's path and placed name leave verbatim; display text under any other key is redacted", () => {
  const token = "token=abc12345";
  const projected = projectDisplay({
    files: [{ path: `notes/${token}.md`, verdict: "missing", placed: `notes/${token}.md` }],
    missing: `retry with ${token}`,
    ignored: [`retry with ${token}`],
  });
  assert.deepEqual(projected.files, [
    { path: `notes/${token}.md`, verdict: "missing", placed: `notes/${token}.md` },
  ]);
  assert.doesNotMatch(projected.missing, /abc12345/);
  assert.doesNotMatch(projected.ignored[0]!, /abc12345/);
});

test("a project's name and instructions leave the registry message as written; the same text elsewhere is redacted", () => {
  const name = "Deploy sk-live-abc";
  const instructions = "Read the token: abc12345 from secretspec. Keys look like sk-live-abc.";
  const shown = projectServerMessage({
    _tag: "registry",
    folders: [],
    projects: [
      { id: "p1", name, instructions },
      { id: "p2", name },
    ],
    sessionReferences: [
      {
        cwd: "/repo",
        sessionId: "s1",
        title: instructions,
        workspaceId: "w1",
        branch: null,
        projectId: "p1",
        archived: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
  assert.equal(shown._tag, "registry");
  assert.deepEqual(shown.projects, [
    { id: "p1", name, instructions },
    { id: "p2", name },
  ]);
  const title = shown.sessionReferences?.[0]?.title ?? "";
  assert.doesNotMatch(title, /abc12345|sk-live-abc/);

  const toast = projectServerMessage({ _tag: "toast", level: "info", message: instructions });
  assert.equal(toast._tag, "toast");
  assert.doesNotMatch(toast.message, /abc12345|sk-live-abc/);
});

test("queued and restored messages leave as typed with controls stripped; other text beside them is redacted", () => {
  const typed = "use password: hunter22";
  const queue = [{ kind: "follow-up" as const, text: `${typed}\u001b[31m` }];
  const expected = [{ kind: "follow-up", text: typed }];
  const cursor = { cwd: "/repo", sessionId: "s1", generation: "g1", sequence: 1 };

  const restored = projectServerMessage({
    _tag: "action_result",
    cwd: "/repo",
    sessionId: "s1",
    result: { _tag: "queue_restored", messages: queue, stopError: `Stop failed: ${typed}` },
  });
  assert.equal(restored._tag, "action_result");
  if (restored._tag !== "action_result" || restored.result._tag !== "queue_restored") return;
  assert.deepEqual(restored.result.messages, expected);
  assert.doesNotMatch(restored.result.stopError ?? "", /hunter22/);

  const logs = projectServerMessage({
    _tag: "action_result",
    cwd: "/repo",
    sessionId: "s1",
    result: { _tag: "preview_observed", instanceId: null, logs: typed },
  });
  assert.equal(logs._tag, "action_result");
  if (logs._tag === "action_result" && logs.result._tag === "preview_observed")
    assert.doesNotMatch(logs.result.logs, /hunter22/);

  const update = projectSessionEvent({ _tag: "queue_update", messages: queue });
  assert.deepEqual(update, { _tag: "queue_update", messages: expected });

  const state = {
    sessionName: typed,
    isStreaming: true,
    queuedMessages: queue,
    context: null,
    cost: 0,
    tokens: 0,
  } as unknown as SessionState;
  const changed = projectSessionEvent({ _tag: "state", state });
  assert.equal(changed._tag, "state");
  if (changed._tag !== "state") return;
  assert.deepEqual(changed.state.queuedMessages, expected);
  assert.doesNotMatch(changed.state.sessionName ?? "", /hunter22/);

  const snapshot = { state, messages: [], dialogs: [] } as unknown as Snapshot;
  const selected = projectServerMessage({
    _tag: "selected",
    selectionId: "sel",
    cursor,
    cwd: "/repo",
    sessionId: "s1",
    hosted: true,
    snapshot,
  } as unknown as ServerMessage);
  assert.equal(selected._tag, "selected");
  if (selected._tag !== "selected") return;
  assert.deepEqual(selected.snapshot.state.queuedMessages, expected);
  assert.doesNotMatch(selected.snapshot.state.sessionName ?? "", /hunter22/);
  assert.deepEqual(projectSnapshot(snapshot).state.queuedMessages, expected);

  const notice = projectServerMessage({ _tag: "toast", level: "info", message: typed });
  assert.equal(notice._tag, "toast");
  if (notice._tag === "toast") assert.doesNotMatch(notice.message, /hunter22/);
});
