import assert from "node:assert/strict";
import { test } from "node:test";
import type { FolderView } from "../shared/wire.ts";
import { initialOpenGroups, nextOpenGroups, type OpenGroups, type OpenGroupsEvent, ownerGroupKey } from "../web/src/lib/sidebarGroups.ts";
import type { GroupBy } from "../web/src/lib/sidebarView.ts";
import { type AppState, initialState } from "../web/src/store.ts";

const folder = (path: string, worktrees: string[] = [path]): FolderView => ({
  path, name: path.slice(1),
  worktrees: worktrees.map(p => ({ workspace: { id: `ws:${p}`, folder: path, path: p }, trust: { required: false, trusted: true }, branch: "main", path: p, root: p === path, status: "current" })),
  discovery: { status: "ready", observedAt: "", currentPath: path, worktrees: [] },
  sessions: [],
});
const registry: AppState = {
  ...initialState, registryLoaded: true,
  folders: [folder("/repo", ["/repo", "/work/repo.feature"]), folder("/other")],
  projects: [{ id: "p1", name: "Launch", archived: false }],
  sessionReferences: [{ cwd: "/work/repo.feature", sessionId: "s1", projectId: "p1", archived: false }],
};
const run = (groups: OpenGroups, ...events: OpenGroupsEvent[]) => events.reduce(nextOpenGroups, groups);
const owner = (state: AppState, cwd: string, sessionId: string | null, groupBy: GroupBy): OpenGroupsEvent =>
  ({ type: "owner", cwd, sessionId, groupBy, key: ownerGroupKey(state, { cwd, sessionId }, groupBy) });
const open = (groups: OpenGroups) => [...groups.open].sort();

test("sidebar groups: a session's owner is its folder (from any worktree) or its project, and nothing in other groupings", () => {
  assert.equal(ownerGroupKey(registry, { cwd: "/work/repo.feature", sessionId: "s1" }, "folder"), "/repo");
  assert.equal(ownerGroupKey(registry, { cwd: "/work/repo.feature", sessionId: "s1" }, "project"), "project:p1");
  assert.equal(ownerGroupKey(registry, { cwd: "/other", sessionId: "s2" }, "project"), "project:", "an unfiled session is in No project");
  assert.equal(ownerGroupKey(registry, { cwd: "/other", sessionId: null }, "project"), "project:", "a new session is in No project");
  assert.equal(ownerGroupKey(registry, { cwd: "/unregistered", sessionId: "s3" }, "folder"), undefined);
  assert.equal(ownerGroupKey(registry, { cwd: "/repo", sessionId: "s1" }, "date"), undefined);
  assert.equal(ownerGroupKey(registry, { cwd: "/repo", sessionId: "s1" }, "none"), undefined);
});

test("sidebar groups: selecting a session opens its group; a registry refresh never reopens a group the user collapsed", () => {
  const selected = run(initialOpenGroups([]), owner(registry, "/work/repo.feature", "s1", "folder"));
  assert.deepEqual(open(selected), ["/repo"]);

  const collapsed = run(selected, { type: "toggle", key: "/repo", open: false });
  assert.deepEqual(open(collapsed), []);
  // Streaming output and other registry updates hand the policy the same selection again (d8fafa0).
  const refreshed: AppState = { ...registry, folders: [...registry.folders], sessionReferences: [...registry.sessionReferences] };
  const after = run(collapsed, owner(refreshed, "/work/repo.feature", "s1", "folder"), owner(refreshed, "/work/repo.feature", "s1", "folder"));
  assert.deepEqual(open(after), [], "the collapsed folder stays closed");
  assert.equal(after, collapsed, "a repeat changes nothing, so nothing is stored or rendered again");
});

test("sidebar groups: a new selection, grouping or owning group reveals the owner again", () => {
  const collapsed = run(initialOpenGroups([]), owner(registry, "/work/repo.feature", "s1", "folder"), { type: "toggle", key: "/repo", open: false });

  assert.deepEqual(open(run(collapsed, owner(registry, "/repo", "s9", "folder"))), ["/repo"], "another session in the same folder");
  assert.deepEqual(open(run(collapsed, owner(registry, "/work/repo.feature", "s1", "project"))), ["project:p1"],"switching to project grouping");

  const filedElsewhere: AppState = { ...registry, projects: [...registry.projects, { id: "p2", name: "Other", archived: false }], sessionReferences: [{ cwd: "/work/repo.feature", sessionId: "s1", projectId: "p2", archived: false }] };
  const inProject = run(initialOpenGroups([]), owner(registry, "/work/repo.feature", "s1", "project"), { type: "toggle", key: "project:p1", open: false });
  assert.deepEqual(open(run(inProject, owner(filedElsewhere, "/work/repo.feature", "s1", "project"))), ["project:p2"], "moving the session to another project opens that one");
});

test("sidebar groups: no owner, or a grouping without groups, leaves the open set and the last reveal alone", () => {
  const start = run(initialOpenGroups(["/other"]), owner(registry, "/repo", "s1", "folder"), { type: "toggle", key: "/repo", open: false });
  const away = run(start, owner(registry, "/repo", "s1", "date"), owner(registry, "/unregistered", "s3", "folder"));
  assert.equal(away, start);
  assert.deepEqual(open(run(away, owner(registry, "/repo", "s1", "folder"))), ["/other"], "coming back to the same reveal does not reopen");
});

test("sidebar groups: a project created after the registry loaded opens; existing ones keep their state", () => {
  const loaded = run(initialOpenGroups([]), { type: "projects", ids: ["p1"] });
  assert.deepEqual(open(loaded), [], "projects present at load keep their stored state");
  const refreshed = run(loaded, { type: "projects", ids: ["p1"] });
  assert.equal(refreshed, loaded);

  const created = run(refreshed, { type: "projects", ids: ["p1", "p2"] });
  assert.deepEqual(open(created), ["project:p2"]);
  const collapsed = run(created, { type: "toggle", key: "project:p2", open: false }, { type: "projects", ids: ["p1", "p2"] });
  assert.deepEqual(open(collapsed), [], "a later refresh does not reopen it");
});

test("sidebar groups: user toggles persist across other events", () => {
  const toggled = run(initialOpenGroups(["/repo"]), { type: "toggle", key: "/other", open: true }, { type: "toggle", key: "/repo", open: false });
  assert.deepEqual(open(toggled), ["/other"]);
  assert.equal(run(toggled, { type: "toggle", key: "/other", open: true }), toggled, "toggling to the current state changes nothing");
  assert.deepEqual(open(run(toggled, { type: "projects", ids: ["p1"] }, owner(registry, "/repo", "s1", "date"))), ["/other"]);
});
