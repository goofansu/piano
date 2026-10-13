import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionShare } from "../shared/share.ts";
import type { ClientCommand, Project, SessionState } from "../shared/wire.ts";
import { answerForm, createCommandForms, SHARE_UNCONFIRMED } from "../web/src/lib/commandForms.ts";
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
const withWorkspace: AppState = {
  ...online,
  workspaces: [{ id: "ws:/repo", folder: "/repo", path: "/repo" }],
};
const shared: SessionShare = {
  url: "https://radius.example/a/1",
  expiresAt: "2026-11-01T00:00:00Z",
  visibility: "organization",
};

const rename = (target: SessionTarget = other): CommandForm => ({ kind: "rename-session", target });
const del = (target: SessionTarget = other): CommandForm => ({ kind: "delete-session", target });
const archive = (target: SessionTarget = other): CommandForm => ({
  kind: "archive-session",
  target,
});
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
  for (const form of [rename(), del(), archive(), closeFolder])
    assert.deepEqual(answerForm(offline, form, "Renamed"), { allowed: false }, form.kind);
});

test("the selected session's forms wait for its resync; other sessions do not", () => {
  assert.equal(answerForm(resyncing, rename(selected), "Renamed").allowed, false);
  assert.equal(answerForm(resyncing, del(selected)).allowed, false);
  assert.equal(answerForm(resyncing, archive(selected)).allowed, false);
  assert.equal(answerForm(resyncing, archive(other)).allowed, true);
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

test("archive, delete and close folder send their registry change", () => {
  assert.deepEqual(answerForm(online, archive()), {
    allowed: true,
    command: { _tag: "archive_session", cwd: "/repo", sessionId: "s2" },
  });
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
  assert.deepEqual(answerForm(online, { kind: "project", dialog: {} }, " Ship ", { newId }), {
    allowed: true,
    command: { _tag: "save_project", project: { id: "new-id", name: "Ship" }, assign: undefined },
    openProject: "new-id",
  });
  assert.deepEqual(
    answerForm(online, { kind: "project", dialog: { project: launch } }, "Relaunch", { newId }),
    {
      allowed: true,
      command: { _tag: "save_project", project: { id: "p1", name: "Relaunch" }, assign: undefined },
    },
  );
  assert.deepEqual(
    answerForm(online, { kind: "project", dialog: { assign: other } }, "Ship", { newId }),
    {
      allowed: true,
      command: {
        _tag: "save_project",
        project: { id: "new-id", name: "Ship" },
        assign: { cwd: "/repo", sessionId: "s2" },
      },
    },
  );
  assert.deepEqual(answerForm(online, { kind: "project", dialog: {} }, "  ", { newId }), {
    allowed: false,
  });
  assert.deepEqual(answerForm(offline, { kind: "project", dialog: {} }, "Ship", { newId }), {
    allowed: false,
  });
});

test("Share needs Radius and a registered workspace", () => {
  const share: CommandForm = { kind: "share-session", target: other };
  assert.equal(answerForm(withWorkspace, share, "", { radiusSignedIn: false }).allowed, false);
  assert.equal(answerForm(online, share, "", { radiusSignedIn: true }).allowed, false);
  assert.deepEqual(answerForm(withWorkspace, share, "", { radiusSignedIn: true }), {
    allowed: true,
    share: { workspaceId: "ws:/repo", sessionId: "s2" },
  });
});

// The forms' lifecycle: open, edit, submit, cancel.

function forms(
  share: (workspaceId: string, sessionId: string) => Promise<SessionShare> = async () => shared,
) {
  let state = withWorkspace;
  const sent: ClientCommand[] = [];
  const opened: string[] = [];
  const published: [string, string][] = [];
  const subject = createCommandForms({
    getState: () => state,
    radiusSignedIn: () => true,
    send: (command) => sent.push(command),
    share: (workspaceId, sessionId) => {
      published.push([workspaceId, sessionId]);
      return share(workspaceId, sessionId);
    },
    openProject: (id) => opened.push(id),
    newId,
  });
  return {
    subject,
    sent,
    opened,
    published,
    setState: (next: AppState) => {
      state = next;
    },
  };
}

const settled = () => new Promise((resolve) => setImmediate(resolve));

test("a form submitted after the connection drops stays open and sends nothing", () => {
  const share: CommandForm = { kind: "share-session", target: other };
  const newProject: CommandForm = { kind: "project", dialog: {} };
  for (const form of [rename(), del(), archive(), closeFolder, share, newProject]) {
    const { subject, sent, published, setState } = forms();
    subject.open(form);
    subject.edit("Renamed");
    setState({ ...withWorkspace, connected: false });
    assert.equal(subject.submit(), false, form.kind);
    assert.equal(subject.getState().form, form, form.kind);
    assert.deepEqual(sent, [], form.kind);
    assert.deepEqual(published, [], form.kind);
  }
});

test("an allowed form sends its answer once, then closes", () => {
  for (const form of [rename(), del(), archive(), closeFolder]) {
    const { subject, sent } = forms();
    subject.open(form);
    subject.edit("Renamed");
    assert.equal(subject.submit(), true, form.kind);
    assert.equal(subject.getState().form, null, form.kind);
    assert.deepEqual(sent, [answerForm(withWorkspace, form, "Renamed").command], form.kind);
    assert.equal(subject.submit(), false, form.kind);
    assert.equal(sent.length, 1, form.kind);
  }
});

test("rename starts from the session's title, and a project edit from its name", () => {
  const { subject } = forms();
  subject.open(rename());
  assert.equal(subject.getState().text, "Other");
  assert.equal(subject.answer().allowed, false);
  subject.open(rename({ cwd: "/repo", sessionId: "s2" }));
  assert.equal(subject.getState().text, "");
  subject.open({ kind: "project", dialog: { project: launch } });
  assert.equal(subject.getState().text, "Launch");
  subject.open(del());
  assert.equal(subject.getState().text, "");
});

test("creating a project opens it; creating one for a session or editing one does not", () => {
  const created = forms();
  created.subject.open({ kind: "project", dialog: {} });
  created.subject.edit(" Ship ");
  assert.equal(created.subject.submit(), true);
  assert.deepEqual(created.sent, [
    { _tag: "save_project", project: { id: "new-id", name: "Ship" }, assign: undefined },
  ]);
  assert.deepEqual(created.opened, ["new-id"]);
  assert.equal(created.subject.getState().form, null);

  for (const dialog of [{ assign: other }, { project: launch }]) {
    const { subject, opened, sent } = forms();
    subject.open({ kind: "project", dialog });
    subject.edit("Ship");
    assert.equal(subject.submit(), true);
    assert.equal(sent.length, 1);
    assert.deepEqual(opened, []);
  }
});

test("Share clicked twice publishes once and stays open on the link", async () => {
  const { subject, published, sent } = forms();
  subject.open({ kind: "share-session", target: other });
  assert.equal(subject.submit(), true);
  assert.equal(subject.submit(), false);
  assert.deepEqual(subject.getState().share, { phase: "publishing" });
  // Dismissing while publishing is ignored, so the outcome is never lost.
  subject.cancel();
  assert.notEqual(subject.getState().form, null);
  await settled();
  assert.deepEqual(subject.getState().share, { phase: "shared", share: shared });
  assert.equal(subject.submit(), false);
  assert.deepEqual(published, [["ws:/repo", "s2"]]);
  assert.deepEqual(sent, []);
  subject.cancel();
  assert.equal(subject.getState().form, null);
});

test("a failed share reports the failure and does not publish again", async () => {
  const { subject, published } = forms(async () => {
    throw new Error("Radius refused the upload.");
  });
  subject.open({ kind: "share-session", target: other });
  subject.submit();
  await settled();
  assert.deepEqual(subject.getState().share, {
    phase: "failed",
    error: "Radius refused the upload.",
  });
  assert.equal(subject.submit(), false);
  assert.equal(published.length, 1);

  const unexplained = forms(() => Promise.reject("lost"));
  unexplained.subject.open({ kind: "share-session", target: other });
  unexplained.subject.submit();
  await settled();
  assert.deepEqual(unexplained.subject.getState().share, {
    phase: "failed",
    error: SHARE_UNCONFIRMED,
  });
});
