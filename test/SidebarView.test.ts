import assert from "node:assert/strict";
import { test } from "node:test";
import { dateGroups, flatSessions, folderGroups, projectGroups, sortSessions } from "../web/src/lib/sidebarView.ts";

const datedSession = (title: string, updatedAt?: string) => ({ title, updatedAt });

const at = (day: number) => `2026-10-${String(day).padStart(2, "0")}T00:00:00Z`;
const session = (cwd: string, sessionId: string, title: string | undefined, day: number) => ({
  cwd, sessionId, title, updatedAt: at(day), createdAt: at(day), workspaceId: cwd,
  branch: "main", hosted: false, streaming: false,
});
const titles = (items: ReadonlyArray<{ title?: string }>) => items.map(s => s.title);
const folders = [
  { name: "zeta", sessions: [session("/zeta", "z1", "Zeta old", 1), session("/zeta", "z2", "Zeta new", 7)] },
  { name: "Alpha", sessions: [] },
  { name: "beta-10", sessions: [session("/beta-10", "b1", undefined, 8), session("/beta-10", "b2", "Beta titled", 3)] },
  { name: "beta-2", sessions: [session("/beta-2", "c1", "Carol", 7)] },
];

test("sidebar view: date sections use inclusive calendar boundaries, omit empties and lose no unknown dates", () => {
  const previousTZ = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const input = [
      { sessions: [datedSession("today", "2026-03-31T00:00:00-04:00"), datedSession("future", "2026-04-02T12:00:00-04:00"), datedSession("yesterday", "2026-03-30T23:59:59-04:00")] },
      { sessions: [datedSession("two", "2026-03-29T23:59:59-04:00"), datedSession("seven", "2026-03-24T00:00:00-04:00"), datedSession("eight", "2026-03-23T23:59:59-04:00"), datedSession("thirty", "2026-03-01T00:00:00-05:00"), datedSession("older", "2026-02-28T23:59:59-05:00"), datedSession("missing"), datedSession("invalid", "not a date"), datedSession("empty", "")] },
    ];
    const result = dateGroups(input, "recent", new Date("2026-03-31T00:05:00-04:00"));
    assert.deepEqual(result.map(g => [g.label, titles(g.sessions)]), [
      ["Today", ["future", "today"]], ["Yesterday", ["yesterday"]],
      ["Previous 7 days", ["two", "seven"]], ["Previous 30 days", ["eight", "thirty"]],
      ["Older", ["older"]], ["Unknown date", ["invalid", "empty", "missing"]],
    ]);
    assert.equal(result.flatMap(g => g.sessions).length, input.flatMap(f => f.sessions).length);
    assert.deepEqual(dateGroups([], "recent").map(g => g.label), []);
    assert.deepEqual(dateGroups([input[0]!], "name", new Date("2026-03-31T12:00:00-04:00")).map(g => [g.label, titles(g.sessions)]), [
      ["Today", ["future", "today"]], ["Yesterday", ["yesterday"]],
    ], "empty buckets are omitted and Name sorts within, not across, sections");
    const byName = dateGroups(input, "name", new Date("2026-03-31T12:00:00-04:00"));
    assert.deepEqual(titles(byName[2]!.sessions), ["seven", "two"]);
    assert.equal(input[0]!.sessions[0]!.title, "today", "input order is preserved");
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

test("sidebar view: local midnight and both DST transitions are calendar days, not elapsed durations", () => {
  const previousTZ = process.env.TZ;
  process.env.TZ = "America/New_York";
  try {
    const spring = [{ sessions: [datedSession("late Saturday", "2026-03-07T23:59:00-05:00"), datedSession("early Sunday", "2026-03-08T00:00:00-05:00")] }];
    assert.deepEqual(dateGroups(spring, "recent", new Date("2026-03-09T00:01:00-04:00")).map(g => [g.label, titles(g.sessions)]), [
      ["Yesterday", ["early Sunday"]], ["Previous 7 days", ["late Saturday"]],
    ], "a time less than 24 hours ago can be two calendar days ago at spring-forward");
    const fall = [{ sessions: [datedSession("early Sunday", "2026-11-01T00:00:00-04:00")] }];
    assert.equal(dateGroups(fall, "recent", new Date("2026-11-02T00:01:00-05:00"))[0]!.label, "Yesterday", "yesterday can be over 25 hours ago at fall-back");
    const midnight = [{ sessions: [datedSession("last minute", "2026-03-31T23:59:00-04:00")] }];
    assert.equal(dateGroups(midnight, "recent", new Date("2026-03-31T23:59:59-04:00"))[0]!.label, "Today");
    assert.equal(dateGroups(midnight, "recent", new Date("2026-04-01T00:00:00-04:00"))[0]!.label, "Yesterday");
    assert.equal(dateGroups([{ sessions: [datedSession("UTC next day", "2026-04-01T02:00:00Z")] }], "recent", new Date("2026-03-31T23:00:00-04:00"))[0]!.label, "Today", "grouping uses the local date, not the ISO date prefix");
  } finally {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  }
});

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
    { ...session("/zeta", "z1", "Zeta old", 1), projectId: "launch" },
    { ...session("/beta-10", "b2", "Beta titled", 3), projectId: "a11y" },
    { ...session("/zeta", "z2", "Zeta new", 7), projectId: "launch" },
    // A member whose folder was closed is still a member.
    { ...session("/closed", "gone", "Closed folder member", 9), projectId: "a11y" },
    { ...session("/beta-2", "c1", "Carol", 7), projectId: undefined },
  ];
  const listed = folders.flatMap(f => f.sessions);
  const recent = projectGroups(projects, references, listed, "recent");
  assert.deepEqual(recent.map(g => g.project?.name ?? null), ["Improve accessibility", "Launch subscriptions", "Empty project", null]);
  assert.deepEqual(titles(recent[0]!.sessions), ["Closed folder member", "Beta titled"]);
  assert.deepEqual(titles(recent.at(-1)!.sessions), [undefined, "Carol"], "unfiled listed sessions, in the same sort");
  assert.deepEqual(projectGroups(projects, references, listed, "name").map(g => g.project?.name ?? null), ["Empty project", "Improve accessibility", "Launch subscriptions", null]);
});
