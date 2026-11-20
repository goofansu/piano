import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderView, SessionState, WorktreeView } from "../shared/wire.ts";
import { addressFor, decideRoute } from "../web/src/lib/navigation.ts";
import {
  anySessionWorking,
  archivedSessionCatalog,
  catalogEntry,
  createSessionCatalog,
  folderFor,
  recentSessions,
  sessionAddress,
  sessionCatalog,
  sessionDestination,
  type SessionEntry,
  unavailableSessionPage,
} from "../web/src/lib/sessionCatalog.ts";
import { sessionContext } from "../web/src/lib/sessionContext.ts";
import {
  dateGroups,
  folderGroups,
  projectGroups,
  sortSessions,
} from "../web/src/lib/sidebarView.ts";
import { type Action, type AppState, initialState, reduce } from "../web/src/store.ts";
import { sessionReference } from "./fixtures/sessionReference.ts";

const worktree = (path: string, branch: string | null, root: boolean): WorktreeView => ({
  workspace: { id: `ws:${path}`, folder: "/repo", path },
  trust: { required: false, trusted: false },
  branch,
  path,
  root,
  status: "current",
});
const ref = (
  cwd: string,
  sessionId: string,
  title: string,
  extra: Parameters<typeof sessionReference>[2] = {},
) => sessionReference(cwd, sessionId, { title, ...extra });
const folder: FolderView = {
  path: "/repo",
  name: "repo",
  worktrees: [worktree("/repo", "main", true), worktree("/work/repo.feature", "feature", false)],
  discovery: { status: "ready", observedAt: "", currentPath: "/repo", worktrees: [] },
};
const state: AppState = {
  ...initialState,
  folders: [folder],
  projects: [{ id: "launch", name: "Launch" }],
  sessionReferences: [
    ref("/repo", "open-unfiled", "Open unfiled", { branch: "main" }),
    ref("/work/repo.feature", "open-member", "Open member", {
      projectId: "launch",
      branch: "feature",
    }),
    ref("/closed/app", "closed-member", "Closed member", {
      projectId: "launch",
      unavailable: "checkout",
    }),
    ref("/closed/app", "closed-unfiled", "Closed unfiled"),
    ref("/closed/app", "lost", "Lost history", { projectId: "launch", unavailable: "history" }),
    ref("/repo", "archived", "Archived", { archived: true }),
  ],
};
const ids = (items: ReadonlyArray<{ sessionId: string }>) => items.map((s) => s.sessionId).sort();

test("every sidebar grouping lists the same sessions: open folders' sessions and project members", () => {
  const listed = sessionCatalog(state).filter((s) => s.listed);
  const expected = ["closed-member", "lost", "open-member", "open-unfiled"];
  assert.deepEqual(
    ids(listed),
    expected,
    "a closed folder's unfiled sessions leave the sidebar; its project members stay",
  );
  assert.deepEqual(
    ids(dateGroups(listed, "recent").flatMap((g) => g.sessions)),
    expected,
    "Date shows a closed folder's project member too",
  );
  assert.deepEqual(ids(sortSessions(listed, "recent")), expected);

  assert.deepEqual(
    ids(
      Object.values(projectGroups(state.projects, listed, "recent"))
        .flat()
        .flatMap((g) => g.sessions),
    ),
    expected,
  );
  assert.deepEqual(
    ids(folderGroups(state.folders, listed, "recent").flatMap((g) => g.sessions)),
    ["open-member", "open-unfiled"],
    "Folder grouping has no group for a closed folder",
  );
});

test("the palette reaches every session that is not archived, with its folder, branch and project", () => {
  const all = sessionCatalog(state);
  assert.deepEqual(ids(all), [
    "closed-member",
    "closed-unfiled",
    "lost",
    "open-member",
    "open-unfiled",
  ]);
  const byId = (id: string) => all.find((s) => s.sessionId === id)!;
  assert.deepEqual(
    (({ folder, branch, project }) => ({
      folder,
      branch,
      project: project?.name,
    }))(byId("open-member")),
    { folder: "repo", branch: "feature", project: "Launch" },
  );
  assert.deepEqual(
    (({ folder, folderPath, branch, project }) => ({
      folder,
      folderPath,
      branch,
      project: project?.name,
    }))(byId("closed-member")),
    { folder: "app", folderPath: undefined, branch: "", project: "Launch" },
    "a closed folder's session is named by its directory",
  );
});

test("an unavailable member says why, and only lost history disables it", () => {
  const all = sessionCatalog(state);
  const lost = all.find((s) => s.sessionId === "lost")!;
  assert.match(lost.hint ?? "", /History unavailable/);
  assert.equal(lost.disabled, true);
  const missing = all.find((s) => s.sessionId === "closed-member")!;
  assert.match(missing.hint ?? "", /Folder missing/);
  assert.equal(missing.disabled, false);
  const fine = all.find((s) => s.sessionId === "open-member")!;
  assert.equal(fine.hint, undefined);
  assert.equal(fine.disabled, false);
});

const hosts = (list: AppState["hosts"]): Action => ({
  type: "server",
  message: { _tag: "hosts", hosts: list },
});
const online = reduce(state, { type: "connected", connected: true });

test("activity follows the live host broadcast, and the selection marks one entry", () => {
  const selecting = {
    ...online,
    selecting: { cwd: "/work/repo.feature", sessionId: "open-member" },
  };
  const busy = reduce(
    selecting,
    hosts([
      { cwd: "/repo", sessionId: "open-unfiled", working: true },
      { cwd: "/work/repo.feature", sessionId: "open-member", working: false },
      { cwd: "/closed/app", sessionId: "closed-member", working: true },
    ]),
  );
  const live = reduce(
    busy,
    hosts([
      { cwd: "/repo", sessionId: "open-unfiled", working: true },
      { cwd: "/work/repo.feature", sessionId: "open-member", working: false },
      { cwd: "/closed/app", sessionId: "closed-member", working: false },
    ]),
  );
  const all = sessionCatalog(live);
  const of = (id: string) => all.find((s) => s.sessionId === id)!;
  assert.equal(of("open-unfiled").activity, "working");
  assert.equal(of("open-member").activity, "idle");
  assert.equal(of("closed-member").activity, "done");
  assert.equal(of("closed-unfiled").activity, "off");
  assert.deepEqual(
    all.filter((s) => s.selected).map((s) => s.sessionId),
    ["open-member"],
  );
});

test("a starting session has no live activity, and a stale host snapshot shows no Working or Idle", () => {
  const memoized = createSessionCatalog();
  const watched = ["open-unfiled", "open-member", "closed-member"];
  const activity = (s: AppState) => {
    const of = (catalog: SessionEntry[]) =>
      watched.map((id) => catalog.find((e) => e.sessionId === id)?.activity);
    const fresh = of(sessionCatalog(s));
    assert.deepEqual(of(memoized(s)), fresh, "the memoized catalog gives the same answer");
    return { sessions: fresh, anyWorking: anySessionWorking(s) };
  };
  const starting = reduce(
    online,
    hosts([
      { cwd: "/repo", sessionId: "open-unfiled", working: true },
      { cwd: "/work/repo.feature", sessionId: "open-member", working: false, starting: true },
      { cwd: "/closed/app", sessionId: "closed-member", working: true },
    ]),
  );
  assert.deepEqual(activity(starting), {
    sessions: ["working", "off", "working"],
    anyWorking: true,
  });
  assert.equal(
    sessionCatalog(starting).find((e) => e.sessionId === "open-member")?.label,
    "Starting",
    "a starting session says so alone",
  );
  const current = reduce(
    starting,
    hosts([
      { cwd: "/repo", sessionId: "open-unfiled", working: true },
      { cwd: "/work/repo.feature", sessionId: "open-member", working: false },
      { cwd: "/closed/app", sessionId: "closed-member", working: false },
    ]),
  );
  assert.deepEqual(activity(current), {
    sessions: ["working", "idle", "done"],
    anyWorking: true,
  });
  const lost = reduce(current, { type: "connected", connected: false, lost: true });
  assert.deepEqual(
    activity(lost),
    { sessions: ["off", "off", "done"], anyWorking: false },
    "a turn already seen to end stays Finished; live Working and Idle are not presented as current",
  );
  const reopened = reduce(lost, { type: "connected", connected: true });
  assert.deepEqual(activity(reopened), activity(lost), "the cached snapshot is stale on reconnect");
  const fresh = reduce(
    reopened,
    hosts([
      { cwd: "/repo", sessionId: "open-unfiled", working: true },
      { cwd: "/work/repo.feature", sessionId: "open-member", working: false },
      { cwd: "/closed/app", sessionId: "closed-member", working: false },
    ]),
  );
  assert.deepEqual(activity(fresh), activity(current));
});

test("startup seen only in a stale host snapshot neither hides the saved title nor blocks opening", () => {
  const memoized = createSessionCatalog();
  const row = (s: AppState, id: string) => {
    const entry = catalogEntry(s, id)!;
    assert.deepEqual(
      memoized(s).find((e) => e.sessionId === id),
      entry,
      "the memoized catalog gives the same answer",
    );
    const { label, activity, disabled } = entry;
    return { label, activity, disabled, destination: sessionDestination(s, id) };
  };
  const startingHosts = hosts([
    { cwd: "/work/repo.feature", sessionId: "open-member", working: false, starting: true },
    { cwd: "/closed/app", sessionId: "lost", working: false, starting: true },
  ]);
  const starting = reduce(online, startingHosts);
  const blocked = { label: "Starting", activity: "off", disabled: true, destination: "unlisted" };
  assert.deepEqual(row(starting, "open-member"), blocked, "current startup blocks opening");

  const saved = {
    label: "Open member",
    activity: "off",
    disabled: false,
    destination: { sessionId: "open-member", cwd: "/work/repo.feature", label: "Open member" },
  };
  const lost = reduce(starting, { type: "connected", connected: false, lost: true });
  assert.deepEqual(row(lost, "open-member"), saved, "cached startup is not current while offline");
  const reopened = reduce(lost, { type: "connected", connected: true });
  assert.deepEqual(row(reopened, "open-member"), saved, "reconnecting alone observes no host");
  assert.deepEqual(
    row(reopened, "lost"),
    { label: "Lost history", activity: "off", disabled: true, destination: "unlisted" },
    "a session without history stays unopenable",
  );

  assert.deepEqual(row(reduce(reopened, startingHosts), "open-member"), blocked);
  assert.deepEqual(
    row(
      reduce(
        reopened,
        hosts([{ cwd: "/work/repo.feature", sessionId: "open-member", working: false }]),
      ),
      "open-member",
    ),
    { ...saved, activity: "idle" },
  );
});

test("archived rows share catalog formatting, include closed folders and sort newest updated first", () => {
  const archived: AppState = {
    ...state,
    sessionReferences: [
      ref("/repo", "visible", "Not archived", { updatedAt: "2026-12-01T00:00:00Z" }),
      ref("/repo", "old", "Older", { archived: true, updatedAt: "2026-10-01T00:00:00Z" }),
      sessionReference("/closed/app/", "new", {
        archived: true,
        updatedAt: "2026-10-03T00:00:00Z",
      }),
      ref("/work/repo.feature", "middle", "Feature", {
        archived: true,
        updatedAt: "2026-10-02T00:00:00Z",
      }),
    ],
  };
  const rows = archivedSessionCatalog(archived);
  assert.deepEqual(
    rows.map(({ sessionId, label, folder, folderPath, cwd }) => ({
      sessionId,
      label,
      folder,
      folderPath,
      cwd,
    })),
    [
      {
        sessionId: "new",
        label: "Untitled",
        folder: "app",
        folderPath: undefined,
        cwd: "/closed/app/",
      },
      {
        sessionId: "middle",
        label: "Feature",
        folder: "repo",
        folderPath: "/repo",
        cwd: "/work/repo.feature",
      },
      { sessionId: "old", label: "Older", folder: "repo", folderPath: "/repo", cwd: "/repo" },
    ],
  );
  for (const row of rows) assert.deepEqual(row, catalogEntry(archived, row.sessionId));
  assert.deepEqual(archivedSessionCatalog(initialState), []);
  assert.deepEqual(
    sessionCatalog(archived).map((s) => s.sessionId),
    ["visible"],
  );
});

test("lookup by ID resolves archived and closed-folder sessions for routing and the title", () => {
  assert.equal(catalogEntry(state, "archived")?.cwd, "/repo");
  assert.equal(catalogEntry(state, "closed-unfiled")?.title, "Closed unfiled");
  assert.equal(catalogEntry(state, "missing"), undefined);
  assert.equal(
    sessionCatalog(state).some((s) => s.sessionId === "archived"),
    false,
    "archived sessions are not listed or searched",
  );
});

test("a session opens at the catalog's directory only while it is not archived and its history is there", () => {
  assert.deepEqual(sessionDestination(state, "open-member"), {
    sessionId: "open-member",
    cwd: "/work/repo.feature",
    label: "Open member",
  });
  assert.deepEqual(
    sessionDestination(state, "closed-member"),
    { sessionId: "closed-member", cwd: "/closed/app", label: "Closed member" },
    "a missing folder still leaves the history readable",
  );
  assert.equal(sessionDestination(state, "lost"), "unlisted", "lost history cannot be opened");
  assert.equal(
    sessionDestination(state, "archived"),
    "unlisted",
    "the server refuses to open an archived session",
  );
  assert.equal(sessionDestination(state, "missing"), "unlisted");
});

test("a session's address selects it only while it is registered, unarchived and its history is there", () => {
  assert.deepEqual(sessionAddress(state, "closed-member"), {
    kind: "select",
    cwd: "/closed/app",
    sessionId: "closed-member",
  });
  assert.deepEqual(sessionAddress(state, "missing"), { kind: "unavailable", reason: "missing" });
  assert.deepEqual(sessionAddress(state, "lost"), { kind: "unavailable", reason: "history" });
  assert.deepEqual(sessionAddress(state, "archived"), { kind: "unavailable", reason: "archived" });
  const archivedLost: AppState = {
    ...state,
    sessionReferences: [ref("/repo", "both", "Both", { archived: true, unavailable: "history" })],
  };
  assert.deepEqual(
    sessionAddress(archivedLost, "both"),
    { kind: "unavailable", reason: "archived" },
    "the server refuses an archived session before it looks for history",
  );
});

test("an unavailable session's page and browser tab agree on why, and only Settings offers Data controls", () => {
  const loaded: AppState = { ...state, registryLoaded: true };
  const pages = (["missing", "lost", "archived"] as const).map((sessionId) => {
    const address = sessionAddress(loaded, sessionId);
    assert.equal(address.kind, "unavailable");
    const decision = decideRoute({ kind: "session", sessionId }, loaded);
    assert.equal(decision.kind, "open");
    const shown: AppState = { ...loaded, view: decision.page };
    const tab = addressFor(shown, null, `/s/${sessionId}`)?.title;
    const reason = address.kind === "unavailable" ? address.reason : "missing";
    for (const settings of [true, false]) {
      const page = unavailableSessionPage(reason, { settings });
      assert.equal(tab, `${page.title} - Piano`, `${reason} with settings ${settings}`);
    }
    return {
      reason,
      local: unavailableSessionPage(reason, { settings: true }),
      remote: unavailableSessionPage(reason, { settings: false }),
    };
  });
  assert.deepEqual(
    pages.map(({ reason, local, remote }) => [reason, local.action, remote.action]),
    [
      ["missing", "new-session", "new-session"],
      ["history", "new-session", "new-session"],
      ["archived", "data-controls", "new-session"],
    ],
  );
  const archived = pages[2]!;
  assert.match(archived.local.description, /Settings → Data controls/);
  assert.doesNotMatch(archived.remote.description, /Settings/);
});

test("an untitled session is called Untitled in the sidebar, its header and the browser tab", () => {
  const untitled: AppState = {
    ...state,
    view: { kind: "session" },
    sessionReferences: [sessionReference("/repo", "blank")],
    session: {
      cwd: "/repo",
      sessionId: "blank",
      hosted: true,
      cursor: null,
      state: { sessionId: "blank" } as SessionState,
      messages: [],
      dialogs: [],
    },
  };
  assert.deepEqual(
    {
      catalog: catalogEntry(untitled, "blank")?.label,
      header: sessionContext(untitled).title,
      tab: addressFor(untitled, null, "/s/blank")?.title,
    },
    { catalog: "Untitled", header: "Untitled", tab: "Untitled - Piano" },
  );
});

test("the palette lists newest first by creation time, a closed folder's session included", () => {
  const dated: AppState = {
    ...state,
    sessionReferences: [
      ref("/repo", "older-open", "Older open", {
        createdAt: "2026-10-01T00:00:00Z",
        updatedAt: "2026-10-09T00:00:00Z",
      }),
      ref("/closed/app", "newest-closed", "Newest closed", {
        createdAt: "2026-10-05T00:00:00Z",
        updatedAt: "2026-10-05T00:00:00Z",
      }),
      ref("/work/repo.feature", "middle-open", "Middle open", {
        createdAt: "2026-10-03T00:00:00Z",
      }),
    ],
  };
  const order = recentSessions(sessionCatalog(dated));
  assert.deepEqual(
    order.map((s) => s.sessionId),
    ["newest-closed", "middle-open", "older-open"],
    "the registry's creation time reaches a session whose folder is closed, so it is not pushed last",
  );
  assert.equal(order[0]!.createdAt, "2026-10-05T00:00:00Z");
  assert.equal(order[0]!.folderPath, undefined);
});

test("a directory two folders list belongs to the first, for one lookup and for the catalog", () => {
  const shared = worktree("/work/shared", "topic", false);
  const first: FolderView = { ...folder, path: "/a", name: "a", worktrees: [shared] };
  const second: FolderView = { ...folder, path: "/b", name: "b", worktrees: [shared] };
  const both: AppState = {
    ...state,
    folders: [first, second],
    sessionReferences: [ref("/work/shared", "s", "Shared")],
  };
  assert.equal(folderFor(both, "/work/shared")?.path, "/a");
  assert.equal(catalogEntry(both, "s")?.folderPath, "/a");
  assert.equal(folderFor(both, "/elsewhere"), undefined);
});
