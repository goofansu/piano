import assert from "node:assert/strict";
import { test } from "node:test";
import type { Project, SessionState } from "../shared/wire.ts";
import { answerForm } from "../web/src/lib/commandForms.ts";
import type { CommandForm } from "../web/src/lib/commands.ts";
import { type SessionTarget, sessionCommands } from "../web/src/lib/sessionCommands.ts";
import { type AppState, initialState, type SessionView } from "../web/src/store.ts";
import { sessionReference } from "./fixtures/sessionReference.ts";

const selected = { cwd: "/repo", sessionId: "s1", title: "Selected" };
const other = { cwd: "/repo", sessionId: "s2", title: "Other" };
const session: SessionView = {
  cwd: "/repo",
  sessionId: "s1",
  hosted: true,
  cursor: null,
  state: { sessionId: "s1" } as SessionState,
  messages: [],
  dialogs: [],
};
const online: AppState = {
  ...initialState,
  connected: true,
  selectionId: "sel",
  view: { kind: "session" },
  session,
  sessionReferences: [sessionReference("/repo", "s1"), sessionReference("/repo", "s2")],
};
const offline: AppState = { ...online, connected: false };
const resyncing: AppState = { ...online, resync: true };
const launch: Project = { id: "p1", name: "Launch", archived: false };
const newId = () => "new-id";

const rename = (target: SessionTarget = other): CommandForm => ({ kind: "rename-session", target });
const del = (target: SessionTarget = other): CommandForm => ({ kind: "delete-session", target });
const closeFolder: CommandForm = { kind: "close-folder", folder: { path: "/repo", name: "repo" } };

test("rename sends the trimmed new title, and refuses an empty or unchanged one", () => {
  assert.deepEqual(answerForm(online, rename(), "  Renamed  "), {
    allowed: true,
    command: { _tag: "rename_session", cwd: "/repo", sessionId: "s2", title: "Renamed" },
  });
  for (const title of ["Other", " Other ", "   ", ""])
    assert.deepEqual(answerForm(online, rename(), title), { allowed: false }, title);
  // An untitled session needs some title.
  assert.equal(answerForm(online, rename({ cwd: "/repo", sessionId: "s2" }), "").allowed, false);
});

test("a form answered after the connection drops is refused", () => {
  for (const form of [rename(), del(), closeFolder])
    assert.deepEqual(answerForm(offline, form, "Renamed"), { allowed: false }, form.kind);
});

test("the selected session's forms wait for its resync; other sessions do not", () => {
  assert.equal(answerForm(resyncing, rename(selected), "Renamed").allowed, false);
  assert.equal(answerForm(resyncing, del(selected)).allowed, false);
  assert.equal(answerForm(resyncing, rename(other), "Renamed").allowed, true);
  assert.equal(answerForm(resyncing, del(other)).allowed, true);
  assert.equal(answerForm(online, rename(selected), "Renamed").allowed, true);
});

test("rename's form follows the descriptor's rule when the checkout is gone", () => {
  const unavailable: AppState = {
    ...online,
    sessionReferences: [sessionReference("/repo", "s2", { unavailable: "checkout" })],
  };
  const descriptor = sessionCommands(unavailable, other).find((c) => c.id === "rename")!;
  assert.equal(descriptor.enabled, false);
  assert.equal(answerForm(unavailable, rename(), "Renamed").allowed, false);
});

test("delete and close folder send their registry change", () => {
  assert.deepEqual(answerForm(online, del()), {
    allowed: true,
    command: { _tag: "delete_session", cwd: "/repo", sessionId: "s2" },
  });
  assert.deepEqual(answerForm(online, closeFolder), {
    allowed: true,
    command: { _tag: "remove_folder", path: "/repo" },
  });
});

test("project answers: a new project opens, an edit keeps its id, create-and-assign stays put", () => {
  assert.deepEqual(answerForm(online, { kind: "project", dialog: {} }, " Ship ", newId), {
    allowed: true,
    command: { _tag: "save_project", project: { id: "new-id", name: "Ship" }, assign: undefined },
    openProject: "new-id",
  });
  assert.deepEqual(
    answerForm(online, { kind: "project", dialog: { project: launch } }, "Relaunch", newId),
    {
      allowed: true,
      command: { _tag: "save_project", project: { id: "p1", name: "Relaunch" }, assign: undefined },
    },
  );
  assert.deepEqual(
    answerForm(online, { kind: "project", dialog: { assign: other } }, "Ship", newId),
    {
      allowed: true,
      command: {
        _tag: "save_project",
        project: { id: "new-id", name: "Ship" },
        assign: { cwd: "/repo", sessionId: "s2" },
      },
    },
  );
  assert.deepEqual(answerForm(online, { kind: "project", dialog: {} }, "  ", newId), {
    allowed: false,
  });
  assert.deepEqual(answerForm(offline, { kind: "project", dialog: {} }, "Ship", newId), {
    allowed: false,
  });
});
