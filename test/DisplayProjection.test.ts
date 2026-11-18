import assert from "node:assert/strict";
import { test } from "node:test";
import { projectDisplay, projectServerMessage } from "../server/DisplayProjection.ts";

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
