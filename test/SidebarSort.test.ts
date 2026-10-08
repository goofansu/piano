import assert from "node:assert/strict";
import { test } from "node:test";
import { sortOutcomeProjects, sortRepositories } from "../web/src/lib/sidebarSort.ts";

const session = (updatedAt: string) => ({ updatedAt });
const repositories = [
  { name: "zeta", sessions: [session("2026-10-01T00:00:00Z"), session("2026-10-07T00:00:00Z")] },
  { name: "Alpha", sessions: [] },
  { name: "beta-10", sessions: [session("2026-10-08T00:00:00Z")] },
  { name: "beta-2", sessions: [session("2026-10-07T00:00:00Z")] },
];
const names = (items: ReadonlyArray<{ name: string }>) => items.map(r => r.name);

test("sidebar sort: repositories keep registry order, or order by name or by latest session, with empty groups last", () => {
  assert.deepEqual(names(sortRepositories(repositories, "added")), ["zeta", "Alpha", "beta-10", "beta-2"]);
  assert.deepEqual(names(sortRepositories(repositories, "name")), ["Alpha", "beta-2", "beta-10", "zeta"], "case-insensitive and numeric-aware");
  assert.deepEqual(names(sortRepositories(repositories, "recent")), ["beta-10", "beta-2", "zeta", "Alpha"], "ties on activity fall back to name; no activity sorts last");
  assert.deepEqual(names(repositories), ["zeta", "Alpha", "beta-10", "beta-2"], "the input is not reordered in place");
});

test("sidebar sort: a project's recency is its members' latest update, read from session references", () => {
  const projects = [{ id: "launch", name: "Launch subscriptions" }, { id: "a11y", name: "Improve accessibility" }, { id: "empty", name: "Empty project" }];
  const references = [
    { outcomeProjectId: "launch", updatedAt: "2026-10-02T00:00:00Z" },
    { outcomeProjectId: "a11y", updatedAt: "2026-10-05T00:00:00Z" },
    { outcomeProjectId: "launch", updatedAt: "2026-10-06T00:00:00Z" },
    { outcomeProjectId: undefined, updatedAt: "2026-10-09T00:00:00Z" },
  ];
  assert.deepEqual(names(sortOutcomeProjects(projects, references, "recent")), ["Launch subscriptions", "Improve accessibility", "Empty project"]);
  assert.deepEqual(names(sortOutcomeProjects(projects, references, "name")), ["Empty project", "Improve accessibility", "Launch subscriptions"]);
  assert.deepEqual(names(sortOutcomeProjects(projects, references, "added")), ["Launch subscriptions", "Improve accessibility", "Empty project"]);
});
