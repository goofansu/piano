import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderView, WorktreeView } from "../shared/wire.ts";
import { projectsIndex, projectsIndexContext } from "../web/src/lib/projectsIndex.ts";
import { type AppState, initialState } from "../web/src/store.ts";
import { sessionReference } from "./fixtures/sessionReference.ts";

const worktree = (folder: string, path: string): WorktreeView => ({
  workspace: { id: `ws:${path}`, folder, path },
  trust: { required: false, trusted: false },
  branch: "main",
  path,
  root: folder === path,
  status: "current",
});
const folder = (path: string, name: string, worktrees: string[] = []): FolderView => ({
  path,
  name,
  worktrees: [worktree(path, path), ...worktrees.map((w) => worktree(path, w))],
  discovery: { status: "ready", observedAt: "", currentPath: path, worktrees: [] },
});
const at = (minute: number) => `2026-10-21T08:${String(minute).padStart(2, "0")}:00Z`;
const state: AppState = {
  ...initialState,
  registryLoaded: true,
  folders: [folder("/piano", "piano", ["/work/piano.index"]), folder("/api", "api")],
  projects: [
    { id: "zed", name: "Zed" },
    { id: "verify", name: "Verify Project" },
    { id: "launch", name: "Launch subscriptions" },
    { id: "alpha", name: "Alpha" },
  ],
  sessionReferences: [
    sessionReference("/piano", "plan", { projectId: "verify", updatedAt: at(10) }),
    sessionReference("/work/piano.index", "index", { projectId: "verify", updatedAt: at(30) }),
    sessionReference("/api", "hook", { projectId: "verify", updatedAt: at(20) }),
    sessionReference("/api", "billing", { projectId: "launch", updatedAt: at(25) }),
    // Archived: neither counted nor dating its project.
    sessionReference("/piano", "old", { projectId: "launch", archived: true, updatedAt: at(50) }),
    sessionReference("/piano", "loose", { updatedAt: at(40) }),
  ],
};

test("the index lists every project, newest member activity first, with its folders and count", () => {
  const index = projectsIndex(state);
  assert.equal(index.kind, "index");
  assert.deepEqual(
    index.rows.map((r) => [r.project.name, r.folders, r.count, r.updatedAt]),
    [
      ["Verify Project", ["piano", "api"], 3, at(30)],
      ["Launch subscriptions", ["api"], 1, at(25)],
      ["Alpha", [], 0, undefined],
      ["Zed", [], 0, undefined],
    ],
    "a folder is named once however many of its worktrees the sessions use; empty projects follow, by name",
  );
  assert.deepEqual(index.rows.map(projectsIndexContext), [
    "piano, api · 3 sessions",
    "api · 1 session",
    "No sessions yet",
    "No sessions yet",
  ]);
});

test("the index waits for the registry rather than showing an empty list", () => {
  assert.deepEqual(projectsIndex({ ...state, registryLoaded: false }), { kind: "loading" });
  assert.deepEqual(projectsIndex({ ...state, projects: [], sessionReferences: [] }), {
    kind: "index",
    rows: [],
  });
});
