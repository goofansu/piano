import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderView, WorktreeView } from "../shared/wire.ts";
import { catalogEntry, recentSessions, sessionCatalog } from "../web/src/lib/sessionCatalog.ts";
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
  projects: [
    { id: "launch", name: "Launch", archived: false },
    { id: "old", name: "Old", archived: true },
  ],
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
    ref("/closed/app", "closed-old-member", "Closed member of an archived project", {
      projectId: "old",
    }),
    ref("/closed/app", "lost", "Lost history", { projectId: "launch", unavailable: "history" }),
    ref("/repo", "archived", "Archived", { archived: true }),
  ],
};
const ids = (items: ReadonlyArray<{ sessionId: string }>) => items.map((s) => s.sessionId).sort();

test("every sidebar grouping lists the same sessions: open folders' sessions and members of open projects", () => {
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
  const active = state.projects.filter((p) => !p.archived);
  assert.deepEqual(
    ids(projectGroups(active, listed, "recent").flatMap((g) => g.sessions)),
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
    "closed-old-member",
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
