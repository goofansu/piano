import assert from "node:assert/strict";
import { test } from "node:test";
import {
  projectDisplay,
  projectServerMessage,
  projectSessionEvent,
  projectSnapshot,
} from "../server/shared/DisplayProjection.ts";
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

test("project names, instructions and session titles leave the registry message as written with controls stripped; the same text elsewhere is redacted", () => {
  const name = "Deploy sk-live-abc";
  const instructions = "Read the token: abc12345 from secretspec. Keys look like sk-live-abc.";
  const title = "Rotate token: abc12345";
  const shown = projectServerMessage({
    _tag: "registry",
    folders: [],
    projects: [
      { id: "p1", name, instructions: `${instructions}\u001b[0m` },
      { id: "p2", name },
    ],
    sessionReferences: [
      {
        cwd: "/repo",
        sessionId: "s1",
        title: `${title}\u001b[31m`,
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
  assert.equal(shown.sessionReferences?.[0]?.title, title);

  const toast = projectServerMessage({
    _tag: "toast",
    level: "info",
    message: `${title} ${instructions}`,
  });
  assert.equal(toast._tag, "toast");
  assert.doesNotMatch(toast.message, /abc12345|sk-live-abc/);
});

test("queued and restored messages and the session name leave as typed with controls stripped; other text beside them is redacted", () => {
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

  const update = projectSessionEvent({ _tag: "queue_update", messages: queue });
  assert.deepEqual(update, { _tag: "queue_update", messages: expected });

  const state = {
    sessionName: `${typed}\u001b[31m`,
    model: typed,
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
  assert.equal(changed.state.sessionName, typed);
  assert.doesNotMatch(changed.state.model ?? "", /hunter22/);

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
  assert.equal(selected.snapshot.state.sessionName, typed);
  assert.doesNotMatch(selected.snapshot.state.model ?? "", /hunter22/);
  assert.deepEqual(projectSnapshot(snapshot).state.queuedMessages, expected);

  const notice = projectServerMessage({ _tag: "toast", level: "info", message: typed });
  assert.equal(notice._tag, "toast");
  if (notice._tag === "toast") assert.doesNotMatch(notice.message, /hunter22/);
});

test("an editor dialog's prefill and an extension's editor text leave as written with controls stripped; the dialog title and message stay redacted", () => {
  const written = "OPENAI_API_KEY=sk-abc12345\nfoo";
  const dialog = {
    id: "d1",
    generation: "g1",
    receivedAt: 0,
    deadlineAt: null,
    deadlineKind: "pi-timeout",
    method: "editor",
    title: "Edit token: abc12345",
    message: "Paste sk-abc12345 here",
    prefill: `${written}\u001b[31m`,
  } as const;
  const asked = projectSessionEvent({ _tag: "dialog", dialog });
  assert.equal(asked._tag, "dialog");
  if (asked._tag !== "dialog") return;
  assert.equal(asked.dialog.prefill, written);
  assert.doesNotMatch(`${asked.dialog.title} ${asked.dialog.message}`, /abc12345/);

  const state = {
    model: "token: abc12345",
    extension: {
      statuses: [{ key: "k", text: "token: abc12345" }],
      widgets: [],
      editorRequest: { id: "g1:e1", text: `${written}\u001b[0m` },
    },
  } as unknown as SessionState;
  const snapshot = projectSnapshot({
    state,
    messages: [],
    dialogs: [dialog],
  } as unknown as Snapshot);
  assert.equal(snapshot.dialogs[0]?.prefill, written);
  assert.doesNotMatch(snapshot.dialogs[0]?.title ?? "", /abc12345/);
  assert.deepEqual(snapshot.state.extension?.editorRequest, { id: "g1:e1", text: written });
  assert.doesNotMatch(snapshot.state.extension?.statuses[0]?.text ?? "", /abc12345/);
  assert.doesNotMatch(snapshot.state.model ?? "", /abc12345/);
});
