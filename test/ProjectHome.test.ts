import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderView, WorktreeView } from "../shared/wire.ts";
import { globalCommands } from "../web/src/lib/globalCommands.ts";
import { projectHome, stableOrder } from "../web/src/lib/projectHome.ts";
import { type AppState, initialState } from "../web/src/store.ts";
import { sessionReference } from "./fixtures/sessionReference.ts";

const worktree = (path: string, branch: string, root: boolean): WorktreeView => ({
  workspace: { id: `ws:${path}`, folder: "/repo", path },
  trust: { required: false, trusted: false },
  branch,
  path,
  root,
  status: "current",
});
const folder: FolderView = {
  path: "/repo",
  name: "repo",
  worktrees: [worktree("/repo", "develop", true), worktree("/work/repo.sort", "fix-sort", false)],
  discovery: { status: "ready", observedAt: "", currentPath: "/repo", worktrees: [] },
};
const at = (minute: number) => `2026-10-21T08:${String(minute).padStart(2, "0")}:00Z`;
const state: AppState = {
  ...initialState,
  registryLoaded: true,
  folders: [folder],
  projects: [
    { id: "p1", name: "Performance tuning" },
    { id: "p2", name: "Other" },
  ],
  sessionReferences: [
    sessionReference("/repo", "newton", {
      title: "newton from katie",
      projectId: "p1",
      branch: "develop",
      updatedAt: at(1),
    }),
    sessionReference("/work/repo.sort", "sort", {
      title: "fix sorting",
      projectId: "p1",
      branch: "fix-sort",
      updatedAt: at(5),
      pullRequest: { url: "https://github.com/eduvo/openapply/pull/26674", source: "manual" },
    }),
    // Its worktree is gone: Git no longer reports a branch for it.
    sessionReference("/work/repo.gone", "gone", { projectId: "p1", updatedAt: at(3) }),
    sessionReference("/repo", "elsewhere", { title: "Other project", projectId: "p2" }),
    sessionReference("/repo", "archived", { projectId: "p1", archived: true, updatedAt: at(9) }),
  ],
};

test("a project's home lists every member session, newest activity first, with its folder, branch and saved pull request", () => {
  const home = projectHome(state, "p1");
  assert.equal(home.kind, "home");
  assert.deepEqual(
    home.sessions.map((s) => ({
      title: s.title,
      folder: s.folder,
      branch: s.branch,
      pullRequest: s.pullRequest,
      updatedAt: s.updatedAt,
    })),
    [
      {
        title: "fix sorting",
        folder: "repo",
        branch: "fix-sort",
        pullRequest: "26674",
        updatedAt: at(5),
      },
      {
        title: undefined,
        folder: "repo.gone",
        branch: "",
        pullRequest: undefined,
        updatedAt: at(3),
      },
      {
        title: "newton from katie",
        folder: "repo",
        branch: "develop",
        pullRequest: undefined,
        updatedAt: at(1),
      },
    ],
    "archived members and other projects' sessions stay out",
  );
});

test("a project's home waits for the registry before deciding the project is missing", () => {
  assert.deepEqual(
    projectHome({ ...state, registryLoaded: false, projects: [] }, "p1"),
    { kind: "loading" },
    "before the first registry message the project is not known to be missing",
  );
  assert.deepEqual(projectHome(state, "gone"), { kind: "missing" });
});

test("rows keep their place while the page is open: new ones append, gone ones drop", () => {
  assert.deepEqual(stableOrder([], ["b", "a"]), ["b", "a"]);
  assert.deepEqual(stableOrder(["b", "a"], ["a", "c", "b"]), ["b", "a", "c"]);
  assert.deepEqual(stableOrder(["b", "a", "c"], ["c", "b"]), ["b", "c"]);
});

test("on a project's home, Mod+K offers New session in project", () => {
  const ctx = { settingsOpen: false, view: { groupBy: "date", sortBy: "recent" } } as const;
  const row = (s: AppState, id: string) => globalCommands(s, ctx).find((c) => c.id === id);
  const home: AppState = { ...state, view: { kind: "project", projectId: "p1" } };
  assert.equal(row(home, "new-session-in-project")?.label, "New session in project");
  assert.deepEqual(row(home, "new-session-in-project")?.intent, {
    kind: "new-session",
    projectId: "p1",
  });
  assert.deepEqual(
    row(home, "new-session")?.intent,
    { kind: "new-session" },
    "New session stays the same everywhere",
  );
  assert.equal(row(state, "new-session-in-project"), undefined, "elsewhere the row is absent");
});
