import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer, type Scope } from "effect";
import { DirectoryCommandsError, DirectoryFacts, DirectoryFactsLive } from "../server/DirectoryFacts.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";
import { RegistryDatabasePath, RegistryLive } from "../server/Registry.ts";
import { SessionHosts, SessionHostsLive } from "../server/SessionHosts.ts";

// HOME is the scratch root, so `~/checkout` and the absolute path name one directory.
const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-facts-")));
const cwd = join(root, "checkout");
mkdirSync(cwd); mkdirSync(join(root, "sessions"));
const previousHome = process.env.HOME;
process.env.HOME = root;
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
after(() => { process.env.HOME = previousHome; rmSync(root, { recursive: true, force: true }); });

let databases = 0;
/** The real module over the fake Pi child; `probes()` counts Pi probes, the observable cost of a cache miss. */
const run = <A, E>(work: (facts: DirectoryFacts["Service"], probes: () => number) => Effect.Effect<A, E, SessionHosts | Scope.Scope>) => {
  let probes = 0;
  const counted = Layer.effect(PiSessions, Effect.map(PiSessions, real => PiSessions.of({
    ...real, probe: (...args) => Effect.suspend(() => { probes++; return real.probe(...args); }),
  }))).pipe(Layer.provide(PiSessionsLive));
  const layer = DirectoryFactsLive.pipe(Layer.provideMerge(SessionHostsLive({ idleMs: 0 })), Layer.provideMerge(counted),
    Layer.provide(RegistryLive), Layer.provide(NodeServices.layer));
  return Effect.runPromise(Effect.gen(function* () { return yield* work(yield* DirectoryFacts, () => probes); }).pipe(
    Effect.scoped, Effect.provide(layer),
    Effect.provideService(PiCli, { node: process.execPath, cli: new URL("./fake-pi.mjs", import.meta.url).pathname, extraArgs: [] }),
    Effect.provideService(RegistryDatabasePath, join(root, `registry-${++databases}.db`)), Effect.timeout("10 seconds")));
};

test("one directory, however a caller spells it, has one catalog entry and one trust answer", async () => {
  await run((facts, probes) => Effect.gen(function* () {
    const spellings = ["~/checkout", `${cwd}/`, cwd, join(root, "other/../checkout")];
    for (const raw of spellings) assert.equal((yield* facts.catalog(raw)).cwd, cwd, raw);
    assert.equal(probes(), 1, "every spelling is answered from the first probe");
    for (const raw of spellings) assert.equal((yield* facts.trust(raw)).cwd, cwd, raw);
    yield* facts.catalog("~/checkout/", { refresh: true });
    yield* facts.catalog(cwd);
    assert.equal(probes(), 2, "a refresh under one spelling replaces the entry the others read");
  }));
});

test("INV-02: commands come from the live session when one is named, otherwise from the directory's probe", async () => {
  await run(facts => Effect.gen(function* () {
    const hosts = yield* SessionHosts;
    const names = (commands: ReadonlyArray<{ name: string }>) => commands.map(c => c.name);
    // The fake Pi lists `probe-only` when started without a session and `live-only` in a session.
    const probed = names(yield* facts.commands("~/checkout"));
    assert.ok(probed.includes("probe-only") && !probed.includes("live-only"), probed.join());
    const session = yield* hosts.open({ cwd, sessionId: crypto.randomUUID(), create: true });
    const live = names(yield* facts.commands("~/checkout", session.spec.sessionId));
    assert.ok(live.includes("live-only") && !live.includes("probe-only"), live.join());
    yield* hosts.release(cwd, session.spec.sessionId);
    const stopped = yield* Effect.flip(facts.commands(cwd, session.spec.sessionId));
    assert.ok(stopped instanceof DirectoryCommandsError && stopped.reason === "stopped", "a stopped session is not reopened to answer");
    assert.deepEqual(yield* hosts.list, []);
  }));
});

test("INV-01/12: a trust decision answers with Pi's fresh trust and a freshly probed catalog", async () => {
  // A project skill makes the directory's trust matter to Pi.
  mkdirSync(join(cwd, ".agents/skills/hello"), { recursive: true });
  writeFileSync(join(cwd, ".agents/skills/hello/SKILL.md"), "---\nname: hello\ndescription: say hello\n---\nSay hello.\n");
  try {
    await run((facts, probes) => Effect.gen(function* () {
      assert.deepEqual((yield* facts.trust(cwd)).trust, { required: true, trusted: false });
      const before = yield* facts.catalog(cwd);
      const elsewhere = join(root, "elsewhere");
      mkdirSync(elsewhere, { recursive: true });
      yield* facts.catalog(elsewhere);
      assert.equal(probes(), 2);
      const trusted = yield* facts.setTrust("~/checkout/", true);
      assert.deepEqual([trusted.cwd, trusted.trust], [cwd, { required: true, trusted: true }]);
      assert.equal(trusted.catalog.cwd, cwd);
      assert.equal(probes(), 3, "the answer carries a new probe, not the cached catalog");
      assert.notEqual(trusted.catalog.fetchedAt, before.fetchedAt);
      assert.equal(yield* facts.catalog(cwd), trusted.catalog, "and that probe is what is cached");
      // Pi resolves trust from the nearest saved ancestor, so every directory re-probes.
      yield* facts.catalog(elsewhere);
      assert.equal(probes(), 4);
      assert.deepEqual((yield* facts.setTrust(cwd, false)).trust, { required: true, trusted: false });
      assert.deepEqual((yield* facts.trust("~/checkout")).trust, { required: true, trusted: false });
    }));
  } finally {
    rmSync(join(cwd, ".agents"), { recursive: true, force: true });
  }
});
