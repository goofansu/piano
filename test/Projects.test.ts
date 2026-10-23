import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Effect } from "effect";
import {
  Registry,
  type RegistryData,
  RegistryDatabasePath,
  RegistryLive,
} from "../server/Registry.ts";
import { seedRegistry } from "./fixtures/registry.ts";

test("a project's instructions are saved trimmed, kept by a rename, cleared when blank, across a restart", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "piano-projects-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "registry.db");
  seedRegistry(path, { projects: [{ id: "launch", name: "Launch" }] });
  const run = <A, E>(effect: Effect.Effect<A, E, Registry>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(RegistryLive), Effect.provideService(RegistryDatabasePath, path)),
    );
  const projects = () => run(Effect.flatMap(Registry, (r) => r.get)).then((d) => d.projects);
  await run(
    Effect.flatMap(Registry, (r) =>
      Effect.andThen(
        r.updateProject("launch", { instructions: "\n  Answer in French.\nKeep it short.  \n" }),
        r.updateProject("launch", { name: " Launch v2 " }),
      ),
    ),
  );
  assert.deepEqual(await projects(), [
    { id: "launch", name: "Launch v2", instructions: "Answer in French.\nKeep it short." },
  ]);
  await run(Effect.flatMap(Registry, (r) => r.updateProject("launch", { instructions: "   " })));
  assert.deepEqual(await projects(), [{ id: "launch", name: "Launch v2" }]);
  const failure = await run(
    Effect.flatMap(Registry, (r) =>
      r.updateProject("missing", { instructions: "x" }).pipe(Effect.flip),
    ),
  );
  assert.match(failure.message, /Project is unavailable/);
});

test("INV-01/07: deleting a project keeps its sessions, in no project, across a restart", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "piano-projects-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "registry.db");
  const cwd = join(root, "api");
  const session = (sessionId: string, projectId?: string) => ({
    cwd,
    sessionId,
    createdAt: "then",
    updatedAt: "now",
    archived: false,
    ...(projectId ? { projectId } : {}),
  });
  seedRegistry(path, {
    folders: [cwd],
    projects: [
      { id: "launch", name: "Launch" },
      { id: "other", name: "Other" },
    ],
    sessions: [session("one", "launch"), session("two", "other"), session("three", "launch")],
  });
  const run = <A, E>(effect: Effect.Effect<A, E, Registry>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(RegistryLive), Effect.provideService(RegistryDatabasePath, path)),
    );
  await run(
    Effect.gen(function* () {
      const r = yield* Registry;
      yield* r.deleteProject("launch");
      const failure = yield* r.deleteProject("launch").pipe(Effect.flip);
      assert.match(failure.message, /Project is unavailable/);
    }),
  );
  const reopened = await run(Effect.flatMap(Registry, (r) => r.get));
  assert.deepEqual(reopened.projects, [{ id: "other", name: "Other" }]);
  assert.deepEqual(
    reopened.sessions.map((s) => [s.sessionId, s.projectId]),
    [
      ["one", undefined],
      ["two", "other"],
      ["three", undefined],
    ],
  );
});

test("INV-01/07: grouping preserves identities and survives closing, moving, renaming and restart", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "piano-projects-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "registry.db");
  const a = join(root, "api"),
    b = join(root, "web");
  const sessions = [
    { cwd: a, sessionId: "one", createdAt: "then", updatedAt: "now", archived: false },
    { cwd: b, sessionId: "two", createdAt: "then", updatedAt: "now", archived: false },
    { cwd: a, sessionId: "three", createdAt: "then", updatedAt: "now", archived: false },
  ];
  const old = {
    folders: [a, b],
    sessions,
    workspaces: [
      { id: "api-id", path: a, folder: a },
      { id: "web-id", path: b, folder: b },
    ],
  };
  seedRegistry(path, old);
  const run = <A, E>(effect: Effect.Effect<A, E, Registry>) =>
    Effect.runPromise(
      effect.pipe(Effect.provide(RegistryLive), Effect.provideService(RegistryDatabasePath, path)),
    );
  await run(
    Effect.gen(function* () {
      const r = yield* Registry;
      const seeded = yield* r.get;
      assert.deepEqual(seeded.workspaces, old.workspaces);
      assert.deepEqual(seeded.sessions, sessions);
      assert.deepEqual(seeded.folders, old.folders);
      assert.deepEqual(seeded.projects, []);
      const first = { id: "launch", name: "Launch subscriptions" };
      yield* r.saveProject(first);
      yield* r.saveProject({ id: "accessibility", name: "Improve accessibility" });
      yield* r.saveProject({ id: "empty", name: "Empty project" });
      yield* r.assignProject(a, "one", "launch");
      yield* r.assignProject(b, "two", "launch");
      yield* r.assignProject(a, "three", "accessibility");
      yield* r.removeFolder(a);
      yield* r.updateProject(first.id, { name: "Subscriptions" });
      const renamed = yield* r.get;
      assert.equal(renamed.projects.find((p) => p.id === first.id)?.name, "Subscriptions");
      assert.equal(renamed.sessions.filter((s) => s.projectId === "launch").length, 2);
      assert.deepEqual(
        renamed.sessions.map(({ projectId, ...s }) => s),
        sessions,
      );
      assert.deepEqual(renamed.workspaces, old.workspaces);
      yield* r.assignProject(a, "one", "accessibility");
      yield* r.assignProject(b, "two", null);
      yield* r.removeSession(a, "three");
      const before = yield* r.get;
      assert.equal(before.projects.length, 3);
      assert.equal(before.sessions.find((s) => s.sessionId === "one")?.projectId, "accessibility");
      assert.equal(before.sessions.find((s) => s.sessionId === "two")?.projectId, undefined);
      assert.equal(before.sessions.length, 2);
      yield* r.assignProject(a, "missing", "launch").pipe(Effect.flip);
      yield* r.assignProject(a, "one", "missing").pipe(Effect.flip);
      yield* r.updateProject(first.id, { name: " " }).pipe(Effect.flip);
      assert.deepEqual(yield* r.get, before);
    }),
  );
  const reopened = await run(
    Effect.gen(function* () {
      return yield* (yield* Registry).get;
    }),
  );
  assert.equal(reopened.sessions[0].projectId, "accessibility");
  assert.deepEqual(reopened.workspaces, old.workspaces);
});

test("INV-01/05: saving a project with a session is one write, announced once, or nothing at all", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "piano-projects-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "registry.db"),
    cwd = join(root, "api");
  seedRegistry(path, {
    folders: [cwd],
    sessions: [{ cwd, sessionId: "one", createdAt: "then", updatedAt: "now", archived: false }],
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const r = yield* Registry;
      const heard: RegistryData[] = [];
      yield* r.onChange((_before, after) =>
        Effect.sync(() => {
          heard.push(after);
        }),
      );

      const before = yield* r.get;
      const failure = yield* r
        .saveProject({ id: "launch", name: "Launch" }, { cwd, sessionId: "missing" })
        .pipe(Effect.flip);
      assert.match(failure.message, /Session reference is unavailable/);
      assert.deepEqual(yield* r.get, before, "an unknown session saves no project either");
      assert.equal(heard.length, 0);

      yield* r.saveProject({ id: "launch", name: "Launch" }, { cwd, sessionId: "one" });
      assert.equal(heard.length, 1, "the project and its session arrive in one announcement");
      assert.deepEqual(heard[0].projects, [{ id: "launch", name: "Launch" }]);
      assert.equal(heard[0].sessions.find((s) => s.sessionId === "one")?.projectId, "launch");
    }).pipe(
      Effect.scoped,
      Effect.provide(RegistryLive),
      Effect.provideService(RegistryDatabasePath, path),
    ),
  );
});
