import assert from "node:assert/strict";
import { test } from "node:test";
import { flatSessions, folderGroups, projectGroups, sortSessions } from "../web/src/lib/sidebarView.ts";

const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T00:00:00Z`;
const session = (cwd: string, sessionId: string, title: string | undefined, day: number) => ({ cwd, sessionId, title, updatedAt: at(day) });
const titles = (items: ReadonlyArray<{ title?: string }>) => items.map(s => s.title);
const folders = [
  { name: "zeta", sessions: [session("/zeta", "z1", "Zeta old", 1), session("/zeta", "z2", "Zeta new", 7)] },
  { name: "Alpha", sessions: [] },
  { name: "beta-10", sessions: [session("/beta-10", "b1", undefined, 8), session("/beta-10", "b2", "Beta titled", 3)] },
  { name: "beta-2", sessions: [session("/beta-2", "c1", "Carol", 7)] },
];

test("sidebar view: sessions sort by title with untitled last, or by last activity", () => {
  const all = folders.flatMap(f => f.sessions);
  assert.deepEqual(titles(sortSessions(all, "name")), ["Beta titled", "Carol", "Zeta new", "Zeta old", undefined]);
  assert.deepEqual(titles(sortSessions(all, "recent")), [undefined, "Carol", "Zeta new", "Beta titled", "Zeta old"], "a tie on activity falls back to the title");
  assert.deepEqual(titles(flatSessions(folders, "recent")), [undefined, "Carol", "Zeta new", "Beta titled", "Zeta old"]);
});

test("sidebar view: folders order by name (case-insensitive, numeric-aware) or by their latest session, empty folders last", () => {
  assert.deepEqual(folderGroups(folders, "name").map(f => f.name), ["Alpha", "beta-2", "beta-10", "zeta"]);
  const recent = folderGroups(folders, "recent");
  assert.deepEqual(recent.map(f => f.name), ["beta-10", "beta-2", "zeta", "Alpha"], "ties on activity fall back to name");
  assert.deepEqual(titles(recent[0]!.sessions), [undefined, "Beta titled"], "sessions inside a folder follow the same sort");
  assert.deepEqual(folders.map(f => f.name), ["zeta", "Alpha", "beta-10", "beta-2"], "the input is not reordered in place");
});

test("sidebar view: project groups come from references, then a No project group holds the listed sessions filed nowhere", () => {
  const projects = [{ id: "launch", name: "Launch subscriptions" }, { id: "a11y", name: "Improve accessibility" }, { id: "empty", name: "Empty project" }];
  const references = [
    { ...session("/zeta", "z1", "Zeta old", 1), outcomeProjectId: "launch" },
    { ...session("/beta-10", "b2", "Beta titled", 3), outcomeProjectId: "a11y" },
    { ...session("/zeta", "z2", "Zeta new", 7), outcomeProjectId: "launch" },
    // A member whose folder was closed is still a member.
    { ...session("/closed", "gone", "Closed folder member", 9), outcomeProjectId: "a11y" },
    { ...session("/beta-2", "c1", "Carol", 7), outcomeProjectId: undefined },
  ];
  const listed = folders.flatMap(f => f.sessions);
  const recent = projectGroups(projects, references, listed, "recent");
  assert.deepEqual(recent.map(g => g.project?.name ?? null), ["Improve accessibility", "Launch subscriptions", "Empty project", null]);
  assert.deepEqual(titles(recent[0]!.sessions), ["Closed folder member", "Beta titled"]);
  assert.deepEqual(titles(recent.at(-1)!.sessions), [undefined, "Carol"], "unfiled listed sessions, in the same sort");
  assert.deepEqual(projectGroups(projects, references, listed, "name").map(g => g.project?.name ?? null), ["Empty project", "Improve accessibility", "Launch subscriptions", null]);
});
