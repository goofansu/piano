import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Effect, Layer } from "effect";
import { Registry, RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionReferences, SessionReferencesLive } from "../server/SessionReferences.ts";

// Fixture history only: Pi reads PI_CODING_AGENT_SESSION_DIR and filters it by each file's cwd.
const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-references-")));
const sessions = join(root, "sessions");
mkdirSync(sessions);
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = sessions;
after(() => rmSync(root, { recursive: true, force: true }));

/** A Pi session file whose header records `cwd`, as Pi writes it when its CLI starts there. */
const seed = (cwd: string, id: string, text: string) => {
  const file = join(sessions, `${text.replaceAll(" ", "-")}.jsonl`);
  writeFileSync(
    file,
    [
      { type: "session", version: 3, id, cwd, timestamp: "2026-10-05T00:00:00Z" },
      {
        type: "message",
        id: "saved",
        parentId: null,
        timestamp: "2026-10-05T00:00:01Z",
        message: { role: "user", content: text, timestamp: 1 },
      },
    ]
      .map((x) => JSON.stringify(x))
      .join("\n") + "\n",
  );
  return file;
};
/** A checkout and a symlinked spelling of it. */
const checkout = (name: string) => {
  const physical = join(root, name),
    alias = join(root, `${name}-alias`);
  mkdirSync(physical);
  symlinkSync(physical, alias);
  return { physical, alias };
};

let databases = 0;
const run = <A, E>(effect: Effect.Effect<A, E, SessionReferences | Registry>) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        SessionReferencesLive.pipe(
          Layer.provideMerge(RegistryLive),
          Layer.provide(Layer.succeed(RegistryDatabasePath, join(root, `${++databases}.db`))),
        ),
      ),
    ),
  );
const refused = <A>(effect: Effect.Effect<A, { readonly detail: string }>) =>
  Effect.map(Effect.flip(effect), (error) => error.detail);

test("INV-01/02: alias history resolves under its registry owner; conflicting references or files refuse", async () => {
  const { physical, alias } = checkout("legacy");
  await run(
    Effect.gen(function* () {
      const references = yield* SessionReferences,
        registry = yield* Registry;
      const file = seed(alias, "legacy", "alias history");
      yield* registry.addSession(alias, "legacy");
      // Asked under the physical spelling, the registry's spelling still owns the session.
      const location = yield* references.resolve(physical, "legacy");
      assert.equal(location.cwd, alias);
      assert.equal(location.physical, physical);
      assert.equal(location.file, file);
      assert.equal(location.checkoutMissing, false);
      const view = yield* references.peek(location);
      assert.equal(view.messages[0].text, "alias history");
      assert.equal(view.state.checkoutMissing, false);
      assert.equal(
        (yield* registry.get).sessions.find((s) => s.sessionId === "legacy")?.cwd,
        alias,
        "resolving never moves the reference",
      );
      seed(physical, "legacy", "different history");
      assert.match(yield* refused(references.resolve(physical, "legacy")), /Conflicting Pi files/);
      yield* registry.addSession(physical, "legacy");
      assert.match(
        yield* refused(references.resolve(physical, "legacy")),
        /Conflicting session references/,
      );
    }),
  );
});

test("INV-01/06: a removed checkout's history stays readable, archivable and deletable", async () => {
  const path = join(root, "removed");
  mkdirSync(path);
  const kept = seed(path, "kept", "preserved conversation");
  const discarded = seed(path, "discarded", "discarded conversation");
  await run(
    Effect.gen(function* () {
      const references = yield* SessionReferences,
        registry = yield* Registry;
      yield* registry.addSession(path, "kept");
      yield* registry.addSession(path, "discarded");
      rmSync(path, { recursive: true });
      const location = yield* references.resolve(path, "kept");
      assert.equal(location.checkoutMissing, true);
      const view = yield* references.peek(location);
      assert.equal(view.messages[0].text, "preserved conversation");
      assert.equal(view.state.checkoutMissing, true);
      assert.match(yield* refused(references.requireCheckout(path)), /checkout no longer exists/);
      mkdirSync(path);
      assert.equal((yield* references.resolve(path, "kept")).checkoutMissing, false);
      rmSync(path, { recursive: true });
      yield* references.archive(location);
      yield* references.remove(yield* references.resolve(path, "discarded"));
      assert.ok(existsSync(kept), "archive keeps Pi's file");
      assert.equal(existsSync(discarded), false, "remove deletes Pi's file");
      assert.match(yield* refused(references.resolve(path, "kept")), /archived/);
      assert.match(yield* refused(references.resolve(path, "discarded")), /no longer registered/);
    }),
  );
});

test("INV-01: availability judges each session as resolve finds it", async () => {
  const { physical, alias } = checkout("judged");
  const gone = join(root, "gone");
  mkdirSync(gone);
  await run(
    Effect.gen(function* () {
      const references = yield* SessionReferences,
        registry = yield* Registry;
      // Pi was started in the physical directory, so its file names that spelling, not the registry's.
      seed(physical, "aliased", "aliased history");
      seed(gone, "removed", "removed history");
      const refs = [
        { cwd: alias, sessionId: "aliased" },
        { cwd: alias, sessionId: "never-written" },
        { cwd: gone, sessionId: "removed" },
      ];
      for (const { cwd, sessionId } of refs) yield* registry.addSession(cwd, sessionId);
      rmSync(gone, { recursive: true });
      const unavailable = yield* references.availability(refs);
      const judged = [];
      for (const { cwd, sessionId } of refs) {
        const location = yield* references.resolve(cwd, sessionId);
        judged.push([
          sessionId,
          unavailable(cwd, sessionId),
          location.file !== undefined,
          location.checkoutMissing,
        ]);
      }
      assert.deepEqual(judged, [
        ["aliased", undefined, true, false],
        ["never-written", "history", false, false],
        ["removed", "checkout", true, true],
      ]);
    }),
  );
});
