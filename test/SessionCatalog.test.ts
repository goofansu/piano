import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderView, SessionState, WorktreeView } from "../shared/wire.ts";
import { addressFor } from "../web/src/lib/navigation.ts";
import {
  catalogEntry,
  folderFor,
  recentSessions,
  sessionCatalog,
  sessionDestination,
} from "../web/src/lib/sessionCatalog.ts";
import { sessionContext } from "../web/src/lib/sessionContext.ts";
import {
  dateGroups,
  folderGroups,
  projectGroups,
  sortSessions,
} from "../web/src/lib/sidebarView.ts";
import { type AppState, initialState } from "../web/src/store.ts";
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
    // The folder holding these was closed.
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
    ids(projectGroups(state.projects, listed, "recent").flatMap((g) => g.sessions)),
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
    (({ folder, branch, inWorktree, project }) => ({
      folder,
      branch,
      inWorktree,
      project: project?.name,
    }))(byId("open-member")),
    { folder: "repo", branch: "feature", inWorktree: true, project: "Launch" },
  );
  assert.equal(
    byId("open-unfiled").inWorktree,
    false,
    "the folder's own checkout is not a worktree",
  );
  assert.deepEqual(
    (({ folder, folderPath, branch, inWorktree, project }) => ({
      folder,
      folderPath,
      branch,
      inWorktree,
      project: project?.name,
    }))(byId("closed-member")),
    { folder: "app", folderPath: undefined, branch: "", inWorktree: false, project: "Launch" },
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

test("activity follows the live host broadcast, and the selection marks one entry", () => {
  const live: AppState = {
    ...state,
    hosts: [
      { cwd: "/repo", sessionId: "open-unfiled", streaming: true },
      { cwd: "/work/repo.feature", sessionId: "open-member", streaming: false },
      { cwd: "/closed/app", sessionId: "closed-member", streaming: false },
    ],
    done: ["/closed/app\nclosed-member"],
    selecting: { cwd: "/work/repo.feature", sessionId: "open-member" },
  } as AppState;
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
  const order = recentSessions(dated);
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
