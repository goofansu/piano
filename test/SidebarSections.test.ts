import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderView } from "../shared/wire.ts";
import { sidebarSections } from "../web/src/lib/sidebarSections.ts";
import type { GroupBy, SidebarView } from "../web/src/lib/sidebarView.ts";
import { type AppState, initialState } from "../web/src/store.ts";
import { sessionReference } from "./fixtures/sessionReference.ts";

const folder: FolderView = {
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
const loaded: AppState = { ...initialState, registryLoaded: true };
const now = new Date(2026, 9, 2);
const view = (groupBy: GroupBy): SidebarView => ({ groupBy, sortBy: "name" });
const GROUPINGS: GroupBy[] = ["folder", "project", "date", "none"];
const titles = (items: ReadonlyArray<{ title?: string }>) => items.map((s) => s.title);

const unfiled = sessionReference("/repo", "unfiled", { title: "Unfiled" });
const pinnedOpen = sessionReference("/repo", "pinned-open", { title: "Pinned open", pinned: true });
// Its folder was closed, so no regular group lists it.
const pinnedClosed = sessionReference("/closed/app", "pinned-closed", {
  title: "Pinned closed",
  pinned: true,
});

test("before the registry arrives every grouping is loading, with no Pinned section", () => {
  const state: AppState = {
    ...initialState,
    folders: [folder],
    sessionReferences: [unfiled, pinnedOpen],
  };
  for (const groupBy of GROUPINGS)
    assert.deepEqual(sidebarSections(state, view(groupBy), now), {
      pinned: [],
      body: { kind: "loading" },
    });
});

test("an empty registry says what to do next, per grouping", () => {
  const noSessions = "No sessions yet. Start one and it appears here.";
  const expected: Record<GroupBy, string> = {
    folder: "No folders yet. Start a session in any folder and it appears here.",
    project: noSessions,
    date: noSessions,
    none: noSessions,
  };
  for (const groupBy of GROUPINGS)
    assert.deepEqual(sidebarSections(loaded, view(groupBy), now), {
      pinned: [],
      body: { kind: "empty", text: expected[groupBy] },
    });
  // An open folder without sessions is a folder group, not the empty state.
  const withFolder = sidebarSections({ ...loaded, folders: [folder] }, view("folder"), now);
  assert.equal(withFolder.body?.kind, "folders");
  assert.equal(
    sidebarSections({ ...loaded, folders: [folder] }, view("date"), now).body?.kind,
    "empty",
  );
});

test("pinned rows stand in for the empty state", () => {
  const state: AppState = { ...loaded, sessionReferences: [pinnedClosed] };
  for (const groupBy of GROUPINGS) {
    const sections = sidebarSections(state, view(groupBy), now);
    assert.deepEqual(titles(sections.pinned), ["Pinned closed"]);
    assert.equal(sections.body, null, groupBy);
  }
});

test("a pinned session shows only under Pinned, even when its folder is closed", () => {
  const state: AppState = {
    ...loaded,
    folders: [folder],
    sessionReferences: [pinnedOpen, unfiled, pinnedClosed],
  };
  const byFolder = sidebarSections(state, view("folder"), now);
  assert.deepEqual(titles(byFolder.pinned), ["Pinned closed", "Pinned open"]);
  assert.equal(byFolder.body?.kind, "folders");
  if (byFolder.body?.kind === "folders")
    assert.deepEqual(
      byFolder.body.groups.map((g) => [g.folder.path, titles(g.sessions)]),
      [["/repo", ["Unfiled"]]],
    );
  const listed = sidebarSections(state, view("none"), now).body;
  assert.equal(listed?.kind, "list");
  if (listed?.kind === "list") assert.deepEqual(titles(listed.sessions), ["Unfiled"]);
  const dated = sidebarSections(state, view("date"), now);
  assert.equal(dated.body?.kind, "dates");
  if (dated.body?.kind === "dates")
    assert.deepEqual(
      dated.body.groups.map((g) => [g.label, titles(g.sessions)]),
      [["Yesterday", ["Unfiled"]]],
    );
});

test("an active project without members is listed with the No project group, not the empty state", () => {
  const state: AppState = {
    ...loaded,
    projects: [
      { id: "launch", name: "Launch", archived: false },
      { id: "old", name: "Old", archived: true },
    ],
  };
  const sections = sidebarSections(state, view("project"), now);
  assert.equal(sections.body?.kind, "projects");
  if (sections.body?.kind === "projects")
    assert.deepEqual(
      sections.body.groups.map((g) => [g.project?.name ?? null, g.sessions.length]),
      [
        ["Launch", 0],
        [null, 0],
      ],
    );
  // Archived projects are not listed, so they alone leave the grouping empty.
  const archivedOnly = { ...state, projects: [{ id: "old", name: "Old", archived: true }] };
  assert.equal(sidebarSections(archivedOnly, view("project"), now).body?.kind, "empty");
});
