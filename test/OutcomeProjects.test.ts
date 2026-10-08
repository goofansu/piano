import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { Registry, RegistryLive, RegistryPath } from "../server/Registry.ts";

test("INV-01/07: v1 migration preserves identities with exact backup; grouping survives closing, moving, archiving and restart", async t => {
  const root = mkdtempSync(join(tmpdir(), "piano-outcomes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "registry.json");
  const a = join(root, "api"), b = join(root, "web");
  const sessions = [
    { cwd: a, sessionId: "one", createdAt: "then", updatedAt: "now", archived: false },
    { cwd: b, sessionId: "two", createdAt: "then", updatedAt: "now", archived: false },
    { cwd: a, sessionId: "three", createdAt: "then", updatedAt: "now", archived: false },
  ];
  const old = { version: 1, projects: [a, b], worktrees: [], sessions, workspaces: [{ id: "api-id", path: a, project: a }, { id: "web-id", path: b, project: b }] };
  const bytes = JSON.stringify(old);
  writeFileSync(path, bytes);
  const run = <A, E>(effect: Effect.Effect<A, E, Registry>) => Effect.runPromise(effect.pipe(Effect.provide(RegistryLive), Effect.provideService(RegistryPath, path)));
  await run(Effect.gen(function* () {
    const r = yield* Registry;
    const migrated = yield* r.get;
    assert.equal(migrated.version, 2);
    assert.deepEqual(migrated.workspaces, old.workspaces);
    assert.deepEqual(migrated.sessions, sessions);
    assert.deepEqual(migrated.projects, old.projects);
    assert.deepEqual(migrated.outcomeProjects, []);
    const first = { id: "launch", name: "Launch subscriptions", goal: "An organizational goal", archived: false };
    yield* r.saveOutcomeProject(first);
    yield* r.saveOutcomeProject({ id: "accessibility", name: "Improve accessibility" });
    yield* r.saveOutcomeProject({ id: "empty", name: "Empty project" });
    yield* r.assignProject(a, "one", "launch");
    yield* r.assignProject(b, "two", "launch");
    yield* r.assignProject(a, "three", "accessibility");
    yield* r.removeProject(a);
    yield* r.archiveOutcomeProject(first.id, true);
    // An editor opened before archive cannot implicitly reopen the grouping.
    yield* r.saveOutcomeProject({ ...first, name: "Subscriptions" });
    const archived = yield* r.get;
    assert.equal(archived.outcomeProjects.find(p => p.id === first.id)?.archived, true);
    assert.equal(archived.sessions.filter(s => s.outcomeProjectId === "launch").length, 2);
    assert.deepEqual(archived.sessions.map(({ outcomeProjectId, ...s }) => s), sessions);
    assert.deepEqual(archived.workspaces, old.workspaces);
    yield* r.archiveOutcomeProject(first.id, false);
    assert.equal((yield* r.get).outcomeProjects.find(p => p.id === first.id)?.name, "Subscriptions");
    yield* r.assignProject(a, "one", "accessibility");
    yield* r.assignProject(b, "two", null);
    yield* r.removeSession(a, "three");
    const before = yield* r.get;
    assert.equal(before.outcomeProjects.length, 3);
    assert.equal(before.sessions.find(s => s.sessionId === "one")?.outcomeProjectId, "accessibility");
    assert.equal(before.sessions.find(s => s.sessionId === "two")?.outcomeProjectId, undefined);
    assert.equal(before.sessions.length, 2);
    yield* r.assignProject(a, "missing", "launch").pipe(Effect.flip);
    yield* r.assignProject(a, "one", "missing").pipe(Effect.flip);
    yield* r.saveOutcomeProject({ ...first, name: " " }).pipe(Effect.flip);
    assert.deepEqual(yield* r.get, before);
  }));
  assert.equal(readFileSync(join(root, readdirSync(root).find(f => f.endsWith(".bak"))!), "utf8"), bytes);
  const reopened = await run(Effect.gen(function* () { return yield* (yield* Registry).get; }));
  assert.equal(reopened.sessions[0].outcomeProjectId, "accessibility");
  assert.deepEqual(reopened.workspaces, old.workspaces);
  for (const invalid of [
    { ...reopened, sessions: [...reopened.sessions, reopened.sessions[0]] },
    { ...reopened, sessions: [{ ...reopened.sessions[0], outcomeProjectId: "missing" }] },
    { ...reopened, outcomeProjects: [...reopened.outcomeProjects, reopened.outcomeProjects[0]] },
    { ...reopened, version: 99 },
  ]) {
    const damaged = JSON.stringify(invalid);
    writeFileSync(path, damaged);
    await assert.rejects(run(Effect.gen(function* () { return yield* (yield* Registry).get; })), /has not been reset/);
    assert.equal(readFileSync(path, "utf8"), damaged);
  }
});
