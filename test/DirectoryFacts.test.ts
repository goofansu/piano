import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import {
  DirectoryCommandsError,
  DirectoryFacts,
  DirectoryFactsLive,
} from "../server/DirectoryFacts.ts";
import { PiCli } from "../server/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../server/PiSessions.ts";

// HOME is the scratch root, so `~/checkout` and the absolute path name one directory.
const root = realpathSync(mkdtempSync(join(tmpdir(), "piano-facts-")));
const cwd = join(root, "checkout");
mkdirSync(cwd);
mkdirSync(join(root, "sessions"));
const previousHome = process.env.HOME;
process.env.HOME = root;
process.env.PI_CODING_AGENT_DIR = join(root, "agent");
process.env.PI_CODING_AGENT_SESSION_DIR = join(root, "sessions");
after(() => {
  process.env.HOME = previousHome;
  rmSync(root, { recursive: true, force: true });
});

/** The real module over the fake Pi child; `probes()` counts Pi probes, the observable cost of a cache miss. */
const run = <A, E>(
  work: (facts: DirectoryFacts["Service"], probes: () => number) => Effect.Effect<A, E>,
) => {
  let probes = 0;
  const counted = Layer.effect(
    PiSessions,
    Effect.map(PiSessions, (real) =>
      PiSessions.of({
        ...real,
        probe: (...args) =>
          Effect.suspend(() => {
            probes++;
            return real.probe(...args);
          }),
      }),
    ),
  ).pipe(Layer.provide(PiSessionsLive));
  const layer = DirectoryFactsLive.pipe(Layer.provide(counted), Layer.provide(NodeServices.layer));
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* work(yield* DirectoryFacts, () => probes);
    }).pipe(
      Effect.provide(layer),
      Effect.provideService(PiCli, {
        node: process.execPath,
        cli: new URL("./fake-pi.mjs", import.meta.url).pathname,
        extraArgs: [],
      }),
      Effect.timeout("10 seconds"),
    ),
  );
};

test("one directory, however a caller spells it, has one catalog entry and one trust answer", async () => {
  await run((facts, probes) =>
    Effect.gen(function* () {
      const spellings = ["~/checkout", `${cwd}/`, cwd, join(root, "other/../checkout")];
      for (const raw of spellings) assert.equal((yield* facts.catalog(raw)).cwd, cwd, raw);
      assert.equal(probes(), 1, "every spelling is answered from the first probe");
      for (const raw of spellings) assert.equal((yield* facts.trust(raw)).cwd, cwd, raw);
      yield* facts.catalog("~/checkout/", { refresh: true });
      yield* facts.catalog(cwd);
      assert.equal(probes(), 2, "a refresh under one spelling replaces the entry the others read");
    }),
  );
});

test("commands before a session starts come from the directory's cached probe, models in wire terms", async () => {
  await run((facts, probes) =>
    Effect.gen(function* () {
      // The fake Pi lists `probe-only` when started without a session and `live-only` in a session.
      const probed = (yield* facts.commands("~/checkout")).map((c) => c.name);
      assert.ok(probed.includes("probe-only") && !probed.includes("live-only"), probed.join());
      const catalog = yield* facts.catalog(cwd);
      assert.equal(probes(), 1, "commands and catalog share one probe");
      // Pi's effort table, already translated: minimal is mapped off and xhigh is mapped in.
      assert.deepEqual(
        catalog.models.map((m) => [m.ref, m.thinkingLevels]),
        [
          ["fake/alpha", ["off", "low", "medium", "high", "xhigh"]],
          ["fake/beta", ["off"]],
        ],
      );
    }),
  );
});

test("a directory whose probe fails has no commands, and the failure is not cached", async () => {
  const missing = join(root, "missing");
  await run((facts, probes) =>
    Effect.gen(function* () {
      const failed = yield* Effect.flip(facts.commands(missing));
      assert.ok(failed instanceof DirectoryCommandsError && failed.detail.length > 0);
      yield* Effect.flip(facts.commands(missing));
      assert.equal(probes(), 2, "the next request probes again");
    }),
  );
});

test("INV-01/12: a trust decision answers with Pi's fresh trust and a freshly probed catalog", async () => {
  // A project skill makes the directory's trust matter to Pi.
  mkdirSync(join(cwd, ".agents/skills/hello"), { recursive: true });
  writeFileSync(
    join(cwd, ".agents/skills/hello/SKILL.md"),
    "---\nname: hello\ndescription: say hello\n---\nSay hello.\n",
  );
  try {
    await run((facts, probes) =>
      Effect.gen(function* () {
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
        assert.equal(
          yield* facts.catalog(cwd),
          trusted.catalog,
          "and that probe is what is cached",
        );
        // Pi resolves trust from the nearest saved ancestor, so every directory re-probes.
        yield* facts.catalog(elsewhere);
        assert.equal(probes(), 4);
        assert.deepEqual((yield* facts.setTrust(cwd, false)).trust, {
          required: true,
          trusted: false,
        });
        assert.deepEqual((yield* facts.trust("~/checkout")).trust, {
          required: true,
          trusted: false,
        });
      }),
    );
  } finally {
    rmSync(join(cwd, ".agents"), { recursive: true, force: true });
  }
});
