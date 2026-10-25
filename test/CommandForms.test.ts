import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionShare } from "../shared/share.ts";
import {
  type ClientCommand,
  decodeClientMessage,
  type FolderView,
  type Project,
  SESSION_TITLE_MAX,
  type SessionReference,
  type SessionState,
} from "../shared/wire.ts";
import {
  answerForm,
  confirmation,
  createCommandForms,
  SHARE_UNCONFIRMED,
} from "../web/src/lib/commandForms.ts";
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
const launch: Project = { id: "p1", name: "Launch" };
const repoFolder: FolderView = {
  path: "/repo",
  name: "repo",
  worktrees: [
    {
      workspace: { id: "ws:/repo", folder: "/repo", path: "/repo" },
      trust: { required: false, trusted: false },
      branch: "main",
      path: "/repo",
      root: true,
      status: "current",
    },
  ],
  discovery: { status: "ready", observedAt: "", currentPath: "/repo", worktrees: [] },
};
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
const deleteProject: CommandForm = { kind: "delete-project", project: launch };

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
  for (const form of [rename(), del(), archive(), closeFolder, deleteProject])
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

test("a session title saves up to its limit, counted trimmed, in the form and on the wire alike", () => {
  const atLimit = ` ${"t".repeat(SESSION_TITLE_MAX)} `;
  const over = "t".repeat(SESSION_TITLE_MAX + 1);
  assert.deepEqual(answerForm(online, rename(), atLimit), {
    allowed: true,
    command: {
      _tag: "rename_session",
      cwd: "/repo",
      sessionId: "s2",
      title: "t".repeat(SESSION_TITLE_MAX),
    },
  });
  assert.deepEqual(answerForm(online, rename(), over), { allowed: false });
  const wire = (title: string) =>
    JSON.stringify({ _tag: "rename_session", cwd: "/repo", sessionId: "s2", title });
  // The server would trim it to fit, so it is accepted.
  assert.equal(decodeClientMessage(wire(atLimit))._tag, "rename_session");
  assert.throws(() => decodeClientMessage(wire(over)));
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

test("deleting a working session says it stops the work; an idle one just deletes", () => {
  const working: AppState = { ...online, hosts: [{ ...other, streaming: true }] };
  assert.deepEqual(confirmation(working, del()), {
    title: "Delete session?",
    description:
      'This will stop the session and interrupt its current work. "Other" and its transcript are removed from Pi\'s session store. This cannot be undone.',
    confirmLabel: "Stop and delete",
    destructive: true,
  });
  assert.deepEqual(confirmation(online, del()), {
    title: "Delete session?",
    description:
      '"Other" and its transcript are removed from Pi\'s session store. This cannot be undone.',
    confirmLabel: "Delete",
    destructive: true,
  });
});

test("archive and close folder name their subject; an untitled session reads Untitled", () => {
  const untitled = { cwd: "/repo", sessionId: "s2" };
  assert.deepEqual(confirmation(online, archive(untitled)), {
    title: "Stop and archive this session?",
    description:
      'This will stop any work still running in "Untitled" and remove it from the sidebar. Its transcript will be kept. Changes already made to files will not be undone.',
    confirmLabel: "Stop and archive",
    destructive: false,
  });
  assert.match(confirmation(online, archive())?.description ?? "", /running in "Other"/);
  assert.match(confirmation(online, del(untitled))?.description ?? "", /^"Untitled"/);
  assert.deepEqual(confirmation(online, closeFolder), {
    title: "Close this folder?",
    description:
      '"repo" will be removed from the sidebar. Files and session history will not be deleted.',
    confirmLabel: "Close",
    destructive: false,
  });
  // Forms with their own dialogs ask nothing here.
  assert.equal(confirmation(online, rename()), undefined);
  assert.equal(confirmation(online, { kind: "share-session", target: other }), undefined);
  assert.equal(confirmation(online, { kind: "project", dialog: {} }), undefined);
});

test("project answers: a new project opens its home, create-and-assign stays put", () => {
  const newProject = (draft: { name: string; instructions?: string }, s = online, dialog = {}) =>
    answerForm(s, { kind: "project", dialog }, { instructions: "", ...draft }, { newId });
  assert.deepEqual(newProject({ name: " Ship " }), {
    allowed: true,
    command: { _tag: "save_project", project: { id: "new-id", name: "Ship" }, assign: undefined },
    open: { kind: "project", projectId: "new-id" },
  });
  assert.deepEqual(newProject({ name: "Ship" }, online, { assign: other }), {
    allowed: true,
    command: {
      _tag: "save_project",
      project: { id: "new-id", name: "Ship" },
      assign: { cwd: "/repo", sessionId: "s2" },
    },
  });
  assert.deepEqual(newProject({ name: "  " }), { allowed: false });
  // Instructions travel in the same save, trimmed; blank ones are left out; over the limit refuses.
  assert.deepEqual(newProject({ name: "Ship", instructions: "\n Reply in French. \n" }).command, {
    _tag: "save_project",
    project: { id: "new-id", name: "Ship", instructions: "Reply in French." },
    assign: undefined,
  });
  assert.deepEqual(newProject({ name: "Ship", instructions: "  " }).command, {
    _tag: "save_project",
    project: { id: "new-id", name: "Ship" },
    assign: undefined,
  });
  assert.equal(newProject({ name: "Ship", instructions: "x".repeat(20_001) }).allowed, false);
  assert.deepEqual(newProject({ name: "Ship" }, offline), { allowed: false });
});

test("deleting a project asks first, counting the sessions that move to No project", () => {
  // Members in the open folder /repo; `extra` sets archived, pinned or another directory.
  const members = (...extras: Array<Partial<SessionReference>>): AppState => ({
    ...online,
    folders: [repoFolder],
    projects: [launch],
    sessionReferences: extras.map((extra, i) =>
      sessionReference("/repo", `m${i}`, { projectId: "p1", ...extra }),
    ),
  });
  assert.deepEqual(confirmation(members({}, {}, { archived: true }), deleteProject), {
    title: "Delete project?",
    description: '"Launch" is deleted; its 2 sessions move to No project. This cannot be undone.',
    confirmLabel: "Delete",
    destructive: true,
  });
  assert.equal(
    confirmation(members({}), deleteProject)!.description,
    '"Launch" is deleted; its session moves to No project. This cannot be undone.',
  );
  assert.equal(
    confirmation(members(), deleteProject)!.description,
    '"Launch" is deleted. This cannot be undone.',
  );
  // A member whose folder is closed leaves the sidebar, and a pinned one stays in Pinned:
  // neither moves to No project.
  assert.equal(
    confirmation(members({}, { cwd: "/closed" }, { pinned: true }), deleteProject)!.description,
    '"Launch" is deleted; its session moves to No project. This cannot be undone.',
  );
  assert.equal(
    confirmation(members({ cwd: "/closed" }, { pinned: true }), deleteProject)!.description,
    '"Launch" is deleted. This cannot be undone.',
  );
});

test("deleting the project on screen leaves for the Projects index once it is gone; deleting another stays put", () => {
  for (const [view, leaves] of [
    [{ kind: "project", projectId: "p1" }, true],
    [{ kind: "new", projectId: "p1" }, true],
    [{ kind: "project", projectId: "p2" }, false],
    [{ kind: "session" }, false],
    // The Projects index offers each project's menu; deleting one there keeps the index.
    [{ kind: "projects" }, false],
  ] as const) {
    const { subject, sent, opened, setState } = forms();
    setState({ ...withWorkspace, view, projects: [launch] });
    subject.open(deleteProject);
    assert.equal(subject.submit(), true);
    assert.deepEqual(sent, [{ _tag: "delete_project", id: "p1" }]);
    // The project's page stays until the server's registry no longer has it.
    subject.settle();
    assert.deepEqual(opened, [], JSON.stringify(view));
    setState({ ...withWorkspace, view, projects: [] });
    subject.settle();
    subject.settle();
    assert.deepEqual(opened, leaves ? ["/projects"] : [], JSON.stringify(view));
  }
});

test("a delete the server refuses, or one cut off by a lost connection, stays on the project's page", () => {
  const view = { kind: "project", projectId: "p1" } as const;
  for (const fail of ["error", "disconnect"] as const) {
    const { subject, opened, setState } = forms();
    setState({ ...withWorkspace, view, projects: [launch] });
    subject.open(deleteProject);
    assert.equal(subject.submit(), true);
    if (fail === "error") subject.hear({ _tag: "error", message: "Project not deleted" });
    else {
      setState({ ...withWorkspace, view, projects: [launch], connected: false });
      subject.settle();
    }
    // A later registry without the project (deleted elsewhere) is not this submit's answer.
    setState({ ...withWorkspace, view, projects: [] });
    subject.settle();
    assert.deepEqual(opened, [], fail);
  }
});

test("a submitted form opens no page once the user has moved to another screen", () => {
  const home = { kind: "project", projectId: "p1" } as const;
  const deleted = forms();
  deleted.setState({ ...withWorkspace, view: home, projects: [launch] });
  deleted.subject.open(deleteProject);
  assert.equal(deleted.subject.submit(), true);
  // The user opens the index while the server is still deleting the project.
  deleted.setState({ ...withWorkspace, view: { kind: "projects" }, projects: [launch] });
  deleted.subject.settle();
  deleted.setState({ ...withWorkspace, view: { kind: "projects" }, projects: [] });
  deleted.subject.settle();
  deleted.setState({ ...withWorkspace, view: home, projects: [] });
  deleted.subject.settle();
  assert.deepEqual(deleted.opened, [], "returning later is not the submit's answer either");

  const created = forms();
  created.subject.open({ kind: "project", dialog: {} });
  created.subject.editProject({ name: "Ship", instructions: "" });
  assert.equal(created.subject.submit(), true);
  created.setState({
    ...withWorkspace,
    view: { kind: "project", projectId: "p1" },
    projects: [launch, { id: "new-id", name: "Ship" }],
  });
  created.subject.settle();
  assert.deepEqual(created.opened, [], "the new project's home does not replace the page opened");
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
    // Each page as its address names it: a project's home, the New page for a project, the index.
    openPage: (page) =>
      opened.push(
        page.kind === "project"
          ? `/projects/${page.projectId}`
          : page.kind === "new"
            ? `/projects/${page.projectId}/new`
            : "/projects",
      ),
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
  const settings: CommandForm = { kind: "project-settings", projectId: "p1" };
  for (const form of [
    rename(),
    del(),
    archive(),
    closeFolder,
    share,
    newProject,
    deleteProject,
    settings,
  ]) {
    const { subject, sent, published, setState } = forms();
    setState({ ...withWorkspace, projects: [launch] });
    subject.open(form);
    subject.edit("Renamed");
    subject.editProject({ name: "Renamed", instructions: "" });
    assert.equal(subject.answer().allowed, true, form.kind);
    setState({ ...withWorkspace, projects: [launch], connected: false });
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

test("rename starts from the session's title, and a new project from nothing", () => {
  const { subject } = forms();
  subject.open(rename());
  assert.equal(subject.getState().text, "Other");
  assert.equal(subject.answer().allowed, false);
  subject.open(rename({ cwd: "/repo", sessionId: "s2" }));
  assert.equal(subject.getState().text, "");
  subject.open({ kind: "project", dialog: {} });
  assert.equal(subject.getState().text, "");
  subject.open(del());
  assert.equal(subject.getState().text, "");
});

test("an untitled selected session renames from the same empty title in the header and its sidebar row", () => {
  const renameTarget = (target?: SessionTarget) => {
    const intent = sessionCommands(withWorkspace, target).find((c) => c.id === "rename")?.intent;
    assert.equal(intent?.kind, "rename");
    return intent.kind === "rename" ? intent.target : undefined;
  };
  // The sidebar row hands over the registry title, which an untitled session lacks.
  const row = { cwd: "/repo", sessionId: "s1", title: undefined };
  assert.deepEqual(renameTarget(), renameTarget(row));
  const { subject } = forms();
  subject.open({ kind: "rename-session", target: renameTarget()! });
  assert.equal(subject.getState().text, "");
  subject.edit("Untitled");
  assert.equal(subject.answer().allowed, true);
});

test("creating a project opens its home; from the New page's picker, the New page for it; for a session, nothing", () => {
  const created = forms();
  created.subject.open({ kind: "project", dialog: {} });
  created.subject.editProject({ name: " Ship ", instructions: "Reply in French." });
  assert.equal(created.subject.submit(), true);
  assert.deepEqual(created.sent, [
    {
      _tag: "save_project",
      project: { id: "new-id", name: "Ship", instructions: "Reply in French." },
      assign: undefined,
    },
  ]);
  assert.equal(created.subject.getState().form, null);
  // Its home opens once the server's registry has it, and only once.
  created.subject.settle();
  assert.deepEqual(created.opened, []);
  const ship: Project = { id: "new-id", name: "Ship", instructions: "Reply in French." };
  created.setState({ ...withWorkspace, projects: [ship] });
  created.subject.settle();
  created.subject.settle();
  assert.deepEqual(created.opened, ["/projects/new-id"]);
  // The next opening starts clean.
  created.subject.open({ kind: "project", dialog: {} });
  assert.equal(created.subject.answer().allowed, false);

  // The New page's project picker keeps its page, with the project it created picked.
  const picked = forms();
  picked.subject.open({ kind: "project", dialog: { newPage: true } });
  picked.subject.editProject({ name: "Ship", instructions: "" });
  assert.equal(picked.subject.submit(), true);
  picked.setState({ ...withWorkspace, projects: [{ id: "new-id", name: "Ship" }] });
  picked.subject.settle();
  assert.deepEqual(picked.opened, ["/projects/new-id/new"]);

  for (const dialog of [{ assign: other }]) {
    const { subject, opened, sent } = forms();
    subject.open({ kind: "project", dialog });
    subject.editProject({ name: "Ship", instructions: "" });
    assert.equal(subject.submit(), true);
    assert.equal(sent.length, 1);
    subject.settle();
    assert.deepEqual(opened, []);
  }
});

test("a new project the server fails to save opens nothing", () => {
  const { subject, opened, setState } = forms();
  subject.open({ kind: "project", dialog: {} });
  subject.editProject({ name: "Ship", instructions: "" });
  assert.equal(subject.submit(), true);
  // A failed session start is that selection's answer, not the save's.
  subject.hear({ _tag: "error", message: "Session not started", selectionId: "sel" });
  subject.hear({ _tag: "error", message: "Project not saved" });
  setState({ ...withWorkspace, projects: [{ id: "new-id", name: "Ship" }] });
  subject.settle();
  assert.deepEqual(opened, []);
});

test("Project settings starts from the project as saved and sends only what changed", () => {
  const saved: Project = { id: "p1", name: "Launch", instructions: "Reply in French." };
  const { subject, sent, setState } = forms();
  setState({ ...withWorkspace, projects: [saved] });
  const settings: CommandForm = { kind: "project-settings", projectId: "p1" };
  subject.open(settings);
  assert.deepEqual(subject.getState().projectDraft, {
    name: "Launch",
    instructions: "Reply in French.",
  });
  // Nothing changed yet, so there is nothing to save.
  assert.equal(subject.submit(), false);
  assert.equal(subject.getState().form, settings);

  subject.editProject({ name: " Ship ", instructions: "Reply in French." });
  assert.equal(subject.submit(), true);
  assert.deepEqual(sent, [{ _tag: "update_project", id: "p1", name: "Ship" }]);
  assert.equal(subject.getState().form, null);

  // Reopening starts from what is saved, not from the last draft.
  subject.open(settings);
  assert.deepEqual(subject.getState().projectDraft, {
    name: "Launch",
    instructions: "Reply in French.",
  });
  subject.editProject({ name: "Launch", instructions: "" });
  assert.equal(subject.submit(), true);
  assert.deepEqual(sent[1], { _tag: "update_project", id: "p1", instructions: null });
});

test("Project settings for a project deleted while open stays open and sends nothing", () => {
  const { subject, sent, setState } = forms();
  setState({ ...withWorkspace, projects: [launch] });
  const settings: CommandForm = { kind: "project-settings", projectId: "p1" };
  subject.open(settings);
  subject.editProject({ name: "Renamed", instructions: "" });
  assert.equal(subject.answer().allowed, true);
  setState({ ...withWorkspace, projects: [] });
  assert.equal(subject.submit(), false);
  assert.equal(subject.getState().form, settings);
  assert.deepEqual(sent, []);
});

test("opening Project settings replaces the open form, and another form replaces it", () => {
  const { subject, sent, setState } = forms();
  setState({ ...withWorkspace, projects: [launch] });
  subject.open(deleteProject);
  subject.open({ kind: "project-settings", projectId: "p1" });
  assert.equal(subject.getState().form?.kind, "project-settings");
  assert.equal(subject.getState().projectDraft.name, "Launch");
  // Submitting answers the settings form, not the replaced confirmation.
  subject.editProject({ name: "Renamed", instructions: "" });
  subject.submit();
  assert.deepEqual(sent, [{ _tag: "update_project", id: "p1", name: "Renamed" }]);

  subject.open({ kind: "project-settings", projectId: "p1" });
  subject.editProject({ name: "Draft", instructions: "" });
  subject.open(rename());
  assert.equal(subject.getState().form?.kind, "rename-session");
  assert.equal(subject.getState().text, "Other");
  // A New project opened next does not inherit the settings draft.
  subject.open({ kind: "project", dialog: {} });
  assert.deepEqual(subject.getState().projectDraft, { name: "", instructions: "" });
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

test("archive and delete say they stop the app a session started", () => {
  const owning: AppState = { ...online, hosts: [{ ...other, streaming: false, preview: true }] };
  assert.deepEqual(confirmation(owning, archive()), {
    title: "Stop and archive this session?",
    description:
      'This will stop the app "Other" started and remove the session from the sidebar. Its transcript will be kept. Changes already made to files will not be undone.',
    confirmLabel: "Stop and archive",
    destructive: false,
  });
  assert.deepEqual(confirmation(owning, del()), {
    title: "Delete session?",
    description:
      'This will stop the app the session started. "Other" and its transcript are removed from Pi\'s session store. This cannot be undone.',
    confirmLabel: "Stop and delete",
    destructive: true,
  });
  const both: AppState = { ...online, hosts: [{ ...other, streaming: true, preview: true }] };
  assert.match(
    confirmation(both, archive())?.description ?? "",
    /^This will stop any work still running in "Other" and the app it started and remove the session from the sidebar\./,
  );
  assert.match(
    confirmation(both, del())?.description ?? "",
    /^This will stop the session and interrupt its current work, and stop the app it started\. /,
  );
});
