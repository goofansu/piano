import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { seedRegistry } from "./fixtures/registry.ts";

test("INV-01/07: grouping preserves identities and survives closing, moving, archiving and restart", async t => {
  const root = mkdtempSync(join(tmpdir(), "piano-projects-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "registry.db");
  const a = join(root, "api"), b = join(root, "web");
  const sessions = [
    { cwd: a, sessionId: "one", createdAt: "then", updatedAt: "now", archived: false },
    { cwd: b, sessionId: "two", createdAt: "then", updatedAt: "now", archived: false },
    { cwd: a, sessionId: "three", createdAt: "then", updatedAt: "now", archived: false },
  ];
  const old = { folders: [a, b], sessions, workspaces: [{ id: "api-id", path: a, folder: a }, { id: "web-id", path: b, folder: b }] };
  seedRegistry(path, old);
  const run = <A, E>(effect: Effect.Effect<A, E, Registry>) => Effect.runPromise(effect.pipe(Effect.provide(RegistryLive), Effect.provideService(RegistryDatabasePath, path)));
  await run(Effect.gen(function* () {
    const r = yield* Registry;
    const seeded = yield* r.get;
    assert.deepEqual(seeded.workspaces, old.workspaces);
    assert.deepEqual(seeded.sessions, sessions);
    assert.deepEqual(seeded.folders, old.folders);
    assert.deepEqual(seeded.projects, []);
    const first = { id: "launch", name: "Launch subscriptions", goal: "An organizational goal", archived: false };
    yield* r.saveProject(first);
    yield* r.saveProject({ id: "accessibility", name: "Improve accessibility" });
    yield* r.saveProject({ id: "empty", name: "Empty project" });
    yield* r.assignProject(a, "one", "launch");
    yield* r.assignProject(b, "two", "launch");
    yield* r.assignProject(a, "three", "accessibility");
    yield* r.removeFolder(a);
    yield* r.archiveProject(first.id, true);
    // An editor opened before archive cannot implicitly reopen the grouping.
    yield* r.saveProject({ ...first, name: "Subscriptions" });
    const archived = yield* r.get;
    assert.equal(archived.projects.find(p => p.id === first.id)?.archived, true);
    assert.equal(archived.sessions.filter(s => s.projectId === "launch").length, 2);
    assert.deepEqual(archived.sessions.map(({ projectId, ...s }) => s), sessions);
    assert.deepEqual(archived.workspaces, old.workspaces);
    yield* r.archiveProject(first.id, false);
    assert.equal((yield* r.get).projects.find(p => p.id === first.id)?.name, "Subscriptions");
    yield* r.assignProject(a, "one", "accessibility");
    yield* r.assignProject(b, "two", null);
    yield* r.removeSession(a, "three");
    const before = yield* r.get;
    assert.equal(before.projects.length, 3);
    assert.equal(before.sessions.find(s => s.sessionId === "one")?.projectId, "accessibility");
    assert.equal(before.sessions.find(s => s.sessionId === "two")?.projectId, undefined);
    assert.equal(before.sessions.length, 2);
    yield* r.assignProject(a, "missing", "launch").pipe(Effect.flip);
    yield* r.assignProject(a, "one", "missing").pipe(Effect.flip);
    yield* r.saveProject({ ...first, name: " " }).pipe(Effect.flip);
    assert.deepEqual(yield* r.get, before);
  }));
  const reopened = await run(Effect.gen(function* () { return yield* (yield* Registry).get; }));
  assert.equal(reopened.sessions[0].projectId, "accessibility");
  assert.deepEqual(reopened.workspaces, old.workspaces);
});
