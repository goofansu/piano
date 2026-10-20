import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderView, SessionState, WorktreeView } from "../shared/wire.ts";
import { directoryTrust } from "../web/src/lib/directoryTrust.ts";
import { sessionDraftKey } from "../web/src/lib/messageDraft.ts";
import {
  completionTarget,
  directoryChoices,
  focusedDirectory,
  sessionActivity,
  sessionCheckoutMissing,
  sessionContext,
  sessionMutable,
  sessionPane,
} from "../web/src/lib/sessionContext.ts";
import { type AppState, initialState, type SessionView } from "../web/src/store.ts";
import { sessionReference } from "./fixtures/sessionReference.ts";

const ws = (path: string) => ({ id: `ws:${path}`, folder: "/repo", path });
const worktree = (
  path: string,
  branch: string | null,
  extra: Partial<WorktreeView> = {},
): WorktreeView => ({
  workspace: ws(path),
  trust: { required: true, trusted: false },
  branch,
  path,
  root: path === "/repo",
  status: "current",
  ...extra,
});
const folder: FolderView = {
  path: "/repo",
  name: "repo",
  worktrees: [worktree("/repo", "main"), worktree("/work/repo.feature", "feature")],
  discovery: { status: "ready", observedAt: "", currentPath: "/repo", worktrees: [] },
};
const session = (
  cwd: string,
  state: Partial<SessionState> = {},
  extra: Partial<SessionView> = {},
): SessionView => ({
  cwd,
  sessionId: "s1",
  hosted: true,
  cursor: null,
  state: { sessionId: "s1", ...state } as SessionState,
  messages: [],
  dialogs: [],
  ...extra,
});
const base: AppState = {
  ...initialState,
  connected: true,
  selectionId: "sel",
  view: { kind: "session" },
  folders: [folder],
  workspaces: [ws("/repo"), ws("/work/repo.feature"), ws("/closed")],
  projects: [{ id: "p1", name: "Launch", archived: false }],
  sessionReferences: [
    sessionReference("/work/repo.feature", "s1", {
      title: "Registry title",
      projectId: "p1",
      branch: "feature",
    }),
  ],
};

test("a worktree session reads its folder, worktree, branch, project and workspace from one place", () => {
  const ctx = sessionContext({ ...base, session: session("/work/repo.feature") });
  assert.equal(ctx.ready, true);
  assert.equal(ctx.folderName, "repo");
  assert.equal(ctx.worktreeName, "feature");
  assert.equal(ctx.branch, "feature");
  assert.equal(ctx.project?.name, "Launch");
  assert.equal(ctx.workspace?.id, "ws:/work/repo.feature");
  assert.equal(ctx.canOpenChanges, true);
  assert.equal(ctx.title, "Registry title", "an unnamed Pi session shows its registry title");
  assert.equal(
    sessionContext({ ...base, session: session("/repo", { sessionName: "Named" }) }).worktreeName,
    undefined,
    "the root checkout must not display a synthetic main branch label",
  );
  assert.equal(
    sessionContext({ ...base, session: session("/repo", { sessionName: "Named" }) }).title,
    "Named",
  );
});

test("a session whose folder was closed keeps its registry workspace for Changes and its pull request", () => {
  const ctx = sessionContext({ ...base, session: session("/closed") });
  assert.equal(ctx.folder, undefined);
  assert.equal(ctx.folderName, "closed");
  assert.equal(ctx.worktreeName, undefined);
  assert.equal(ctx.branch, undefined);
  assert.equal(ctx.workspace?.id, "ws:/closed");
  assert.equal(ctx.changesWorkspace?.id, "ws:/closed");
  assert.equal(ctx.canOpenChanges, true);
});

test("only a session whose composer accepts input has a writable draft", () => {
  const live = sessionContext({ ...base, session: session("/work/repo.feature") });
  assert.equal(live.draftKey, sessionDraftKey({ cwd: "/work/repo.feature", sessionId: "s1" }));
  const missing = sessionContext({
    ...base,
    session: session("/work/repo.feature", { checkoutMissing: true }),
  });
  assert.equal(missing.draftKey, null, "a read-only session's draft takes no additions");
  assert.equal(sessionContext({ ...base, session: null }).draftKey, null);
});

test("a removed checkout keeps its workspace identity but cannot open Changes; a non-Git folder has no Changes workspace", () => {
  const missing = sessionContext({
    ...base,
    session: session("/work/repo.feature", { checkoutMissing: true }),
  });
  assert.equal(missing.checkoutMissing, true);
  assert.equal(missing.workspace?.id, "ws:/work/repo.feature");
  assert.equal(missing.canOpenChanges, false);
  const plain: FolderView = {
    ...folder,
    worktrees: [worktree("/repo", null, { status: "non-git" })],
    discovery: { status: "non-git", observedAt: "" },
  };
  const nonGit = sessionContext({ ...base, folders: [plain], session: session("/repo") });
  assert.equal(nonGit.workspace?.id, "ws:/repo");
  assert.equal(nonGit.changesWorkspace, undefined);
  assert.equal(nonGit.canOpenChanges, false);
  assert.equal(nonGit.branch, undefined);
});

test("readiness needs a connected, settled attachment", () => {
  const current = { ...base, session: session("/repo") };
  assert.equal(sessionContext(current).ready, true);
  for (const state of [
    { ...current, connected: false },
    { ...current, resync: true },
    { ...current, selecting: { cwd: "/repo", sessionId: "s2" } },
    { ...current, selectionId: null },
  ]) {
    assert.equal(sessionContext(state).ready, false);
    assert.equal(sessionActivity(state, false).status, "Reconnecting");
  }
});

test("status precedence: startup, delivery, reconnecting, read-only, exited, then activity", () => {
  const status = (state: AppState) => sessionActivity(state, false).status;
  const pending = { selectionId: "create", cwd: "/repo", text: "hi", outcome: "starting" as const };
  assert.equal(status({ ...base, pendingCreate: pending }), "Starting");
  assert.equal(
    status({
      ...base,
      pendingCreate: pending,
      session: session(
        "/repo",
        {},
        { dialogs: [{ id: "d", method: "confirm", title: "Q" } as never] },
      ),
    }),
    "Waiting for input",
    "a dialog outranks startup",
  );
  assert.equal(
    status({ ...base, pendingCreate: { ...pending, outcome: "uncertain" } }),
    "Delivery uncertain",
  );
  assert.equal(
    status({ ...base, pendingCreate: { ...pending, outcome: "rejected" } }),
    "Message rejected",
    "a rejected selection is known not to have delivered",
  );
  assert.equal(status({ ...base }), "Loading");
  assert.equal(
    status({
      ...base,
      session: session("/repo", {
        checkoutMissing: true,
        closure: { _tag: "failed", detail: "x" },
      }),
    }),
    "Read-only",
  );
  assert.equal(
    status({ ...base, session: session("/repo", { closure: { _tag: "failed", detail: "x" } }) }),
    "Exited",
  );
  assert.equal(
    status({ ...base, session: session("/repo", { isCompacting: true, isRetrying: true }) }),
    "Compacting · Retrying",
  );
  assert.equal(status({ ...base, session: session("/repo", { isStreaming: true }) }), "Working");
  assert.equal(status({ ...base, session: session("/repo") }), "Ready");
  assert.equal(
    status({ ...base, session: session("/repo", {}, { hosted: false }) }),
    "Not running",
  );
});

test("reply activity yields to visible pending text, except in Messages display", () => {
  const streaming = {
    ...base,
    session: session(
      "/repo",
      { isStreaming: true },
      { pending: { id: "p", role: "assistant", text: "partial" } },
    ),
  };
  assert.equal(sessionActivity(streaming, false).replyActivity, undefined);
  assert.equal(sessionActivity(streaming, true).replyActivity, "working");
  assert.equal(
    sessionActivity(
      {
        ...base,
        pendingCreate: { selectionId: "create", cwd: "/repo", text: "", outcome: "starting" },
      },
      false,
    ).replyActivity,
    "starting",
  );
});

test("the session pane: a loading session shows the skeleton and nothing else", () => {
  assert.deepEqual(sessionPane({ ...base, selecting: { cwd: "/repo", sessionId: "s1" } }), {
    list: false,
    skeleton: true,
    placeholder: undefined,
    composerDisabled: true,
  });
});

test("the session pane: a first message shows at once, without skeleton, until Pi has the session", () => {
  const input = { selectionId: "create", cwd: "/repo", text: "hi", outcome: "starting" as const };
  assert.deepEqual(sessionPane({ ...base, pendingCreate: input }), {
    list: true,
    skeleton: false,
    placeholder: undefined,
    composerDisabled: true,
  });
  // Pi's session is attached but still starting: the first message stays, the composer waits.
  const attached = sessionPane({ ...base, pendingCreate: input, session: session("/repo") });
  assert.equal(attached.skeleton, false);
  assert.equal(attached.placeholder, undefined, "the first message is not an empty transcript");
  assert.equal(attached.composerDisabled, true);
  const submitted = sessionPane({
    ...base,
    pendingCreate: { ...input, outcome: "submitted" },
    session: session("/repo"),
  });
  assert.equal(submitted.composerDisabled, false);
  // A failed first message keeps its text in view instead of a loading skeleton.
  assert.equal(
    sessionPane({ ...base, pendingCreate: { ...input, outcome: "rejected" } }).skeleton,
    false,
  );
});

test("the session pane: a failed selection has no skeleton", () => {
  const pane = sessionPane({
    ...base,
    selectionFailure: { cwd: "/repo", sessionId: "s1", message: "gone" },
  });
  assert.equal(pane.skeleton, false);
  assert.equal(pane.list, false);
});

test("the session pane: a settled empty session says so and drops the skeleton", () => {
  for (const hosted of [true, false]) {
    const pane = sessionPane({ ...base, session: session("/repo", {}, { hosted }) });
    assert.deepEqual(pane, {
      list: true,
      skeleton: false,
      placeholder: "No messages yet.",
      composerDisabled: false,
    });
  }
  const withHistory = sessionPane({
    ...base,
    session: session("/repo", {}, { messages: [{ id: "m", role: "user", text: "hi" }] }),
  });
  assert.equal(withHistory.skeleton, false);
  assert.equal(withHistory.placeholder, undefined);
});

test("the session pane: input Pi has not answered keeps the skeleton and no placeholder", () => {
  const submitting = sessionPane({
    ...base,
    session: session("/repo", { submission: { id: 1, outcome: "submitting" } }),
  });
  assert.equal(submitting.skeleton, true);
  assert.equal(submitting.placeholder, undefined);
  // Pi's reply has begun: the transcript replaces the skeleton.
  const replying = sessionPane({
    ...base,
    session: session(
      "/repo",
      { isStreaming: true },
      { pending: { id: "p", role: "assistant", text: "partial" } },
    ),
  });
  assert.equal(replying.skeleton, false);
  assert.equal(replying.placeholder, undefined);
});

test("the session pane: work under way is never described as an empty session", () => {
  for (const working of [{ isStreaming: true }, { isCompacting: true }, { isRetrying: true }]) {
    const pane = sessionPane({ ...base, session: session("/repo", working) });
    assert.equal(pane.placeholder, undefined, JSON.stringify(working));
    assert.equal(pane.skeleton, true, JSON.stringify(working));
  }
});

test("the session pane: the composer waits for a ready attachment", () => {
  const current = { ...base, session: session("/repo") };
  assert.equal(sessionPane(current).composerDisabled, false);
  for (const state of [
    { ...current, connected: false },
    { ...current, resync: true },
    { ...current, selectionId: null },
  ])
    assert.equal(sessionPane(state).composerDisabled, true);
});

test("directory trust prefers the latest probe over discovery", () => {
  assert.deepEqual(directoryTrust(base, "/repo"), { required: true, trusted: false });
  assert.deepEqual(
    directoryTrust({ ...base, trusts: { "/repo": { required: true, trusted: true } } }, "/repo"),
    { required: true, trusted: true },
  );
  assert.equal(directoryTrust(base, "/elsewhere"), undefined);
});

test("the selected session waits for a settled attachment before registry changes; other sessions do not", () => {
  const selected = { cwd: "/work/repo.feature", sessionId: "s1" };
  const other = { cwd: "/repo", sessionId: "s2" };
  const settled = { ...base, session: session("/work/repo.feature") };
  assert.equal(sessionMutable(settled, selected), true);
  assert.equal(sessionMutable({ ...settled, resync: true }, selected), false);
  assert.equal(sessionMutable({ ...settled, resync: true }, other), true);
  assert.equal(sessionMutable({ ...settled, connected: false }, other), false);
  // The New page has no selection; sidebar rows stay actionable there.
  assert.equal(sessionMutable({ ...base, selectionId: null, view: { kind: "new" } }, other), true);
  assert.equal(
    sessionCheckoutMissing(
      { ...base, session: session("/work/repo.feature", { checkoutMissing: true }) },
      selected,
    ),
    true,
  );
  assert.equal(
    sessionCheckoutMissing(
      {
        ...base,
        sessionReferences: [
          sessionReference(other.cwd, other.sessionId, { unavailable: "checkout" }),
        ],
      },
      other,
    ),
    true,
  );
  assert.equal(sessionCheckoutMissing(settled, other), false);
});

test("the focused directory is the New page's directory, else the selected session's, which the palette's trust command targets", () => {
  assert.deepEqual(
    focusedDirectory({ ...base, view: { kind: "new", cwd: "/repo" }, session: null }),
    { cwd: "/repo", checkoutMissing: false },
  );
  assert.equal(focusedDirectory({ ...base, view: { kind: "new" }, session: null }), undefined);
  assert.deepEqual(focusedDirectory({ ...base, session: session("/work/repo.feature") }), {
    cwd: "/work/repo.feature",
    checkoutMissing: false,
  });
  assert.deepEqual(
    focusedDirectory({ ...base, session: session("/gone", { checkoutMissing: true }) }),
    { cwd: "/gone", checkoutMissing: true },
  );
  assert.equal(
    focusedDirectory({ ...base, session: null, selecting: { cwd: "/repo", sessionId: "s1" } }),
    undefined,
    "nothing is focused until the snapshot arrives",
  );
});

test("slash completion uses one revision rule for the New page and a session", () => {
  const fresh = {
    ...base,
    view: { kind: "new" as const, cwd: "/repo" },
    selectionId: null,
    session: null,
  };
  const target = completionTarget(fresh);
  assert.equal(target?.cwd, "/repo");
  assert.equal(target?.session, undefined);
  assert.notEqual(
    completionTarget({ ...fresh, trusts: { "/repo": { required: true, trusted: true } } })
      ?.revision,
    target?.revision,
    "a trust change invalidates discovery",
  );
  assert.equal(completionTarget({ ...fresh, connected: false }), undefined);
  const hosted = completionTarget({ ...base, session: session("/repo") });
  assert.deepEqual(
    [hosted?.cwd, hosted?.session],
    ["/repo", { workspaceId: "ws:/repo", sessionId: "s1" }],
    "a running session is asked by its IDs",
  );
  const saved = completionTarget({ ...base, session: session("/repo", {}, { hosted: false }) });
  assert.deepEqual(
    [saved?.cwd, saved?.session],
    ["/repo", undefined],
    "discovery never starts a saved session",
  );
  assert.equal(
    completionTarget({ ...base, workspaces: [], session: session("/repo") }),
    undefined,
    "a running session without a known workspace is not asked",
  );
  assert.equal(
    completionTarget({ ...base, resync: true, session: session("/repo") }),
    undefined,
    "only on a ready attachment",
  );
});

test("the New session directory picker names a root by folder, a worktree by folder and branch, and anything else by path", () => {
  const root = directoryChoices(base, "/repo");
  assert.deepEqual(root.trigger, { kind: "checkout", folder: "repo" });
  assert.equal(root.worktreesFolder?.path, "/repo");
  assert.deepEqual(root.roots, [{ path: "/repo", label: "repo", disabled: false, selected: true }]);
  const feature = directoryChoices(base, "/work/repo.feature");
  assert.deepEqual(feature.trigger, { kind: "checkout", folder: "repo", branchLabel: "feature" });
  assert.equal(
    feature.worktreesFolder?.path,
    "/repo",
    "worktrees belong to the folder's repository",
  );
  assert.equal(feature.roots[0]?.selected, false);
  const elsewhere = directoryChoices(base, "/Users/me/scratch");
  assert.deepEqual(elsewhere.trigger, { kind: "path", label: "~/scratch" });
  assert.equal(elsewhere.worktreesFolder, undefined, "an unregistered directory has no Worktrees");
  assert.deepEqual(directoryChoices(base, "").trigger, { kind: "none" });
});

test("the New session directory picker disables a missing root and labels a branchless worktree", () => {
  const facts = (detached: boolean) => ({
    path: "/work/repo.x",
    branch: null,
    detached,
    prunable: false,
  });
  const withWorktree = (w: WorktreeView): AppState => ({
    ...base,
    folders: [{ ...folder, worktrees: [worktree("/repo", "main", { status: "missing" }), w] }],
  });
  const detached = withWorktree(worktree("/work/repo.x", null, { facts: facts(true) }));
  assert.equal(directoryChoices(detached, "/repo").roots[0]?.disabled, true);
  assert.deepEqual(directoryChoices(detached, "/work/repo.x").trigger, {
    kind: "checkout",
    folder: "repo",
    branchLabel: "Detached HEAD",
  });
  const unknown = withWorktree(worktree("/work/repo.x", null, { facts: facts(false) }));
  assert.deepEqual(directoryChoices(unknown, "/work/repo.x").trigger, {
    kind: "checkout",
    folder: "repo",
    branchLabel: "Unknown branch",
  });
});
