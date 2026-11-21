import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { NodeServices } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import { PiSettings, PiSettingsLive } from "../../../server/features/models/PiSettings.ts";
import { PiCli } from "../../../server/features/sessions/pi/PiCli.ts";
import { PiSessions, PiSessionsLive } from "../../../server/features/sessions/pi/PiSessions.ts";
import { DirectoryFactsLive } from "../../../server/features/workspace/DirectoryFactsLive.ts";
import { DirectoryFacts } from "../../../server/shared/DirectoryFacts.ts";
import { createPiCompatibilityFixture } from "../../fixtures/PiCompatibility.ts";

test("INV-01/12: machine defaults persist in Pi, invalidate cached startup choices and leave sessions and folder overrides alone", async () => {
  const fixture = await createPiCompatibilityFixture();
  fixture.configureSentinel("disabled");
  const project = fixture.project("overridden");
  const path = join(fixture.agentDir, "settings.json");
  writeFileSync(path, JSON.stringify({ cacheWarming: "off", theme: "dark" }));
  const saved = () => {
    const { defaultProvider, defaultModel, defaultThinkingLevel } = JSON.parse(
      readFileSync(path, "utf8"),
    );
    return { defaultProvider, defaultModel, defaultThinkingLevel };
  };
  const previous = { HOME: process.env.HOME, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
  process.env.HOME = fixture.root;
  process.env.PI_CODING_AGENT_DIR = fixture.agentDir;
  try {
    const layer = PiSettingsLive.pipe(
      Layer.provideMerge(DirectoryFactsLive),
      Layer.provideMerge(PiSessionsLive),
      Layer.provide(NodeServices.layer),
    );
    await Effect.runPromise(
      Effect.gen(function* () {
        const settings = yield* PiSettings,
          catalogs = yield* DirectoryFacts,
          sessions = yield* PiSessions;
        const globalProbe = yield* sessions.probe(project, { globalSettingsOnly: true });
        assert.notEqual(globalProbe.defaultModel, "piano-phase0/project");
        const initial = yield* catalogs.catalog(fixture.root);
        const session = yield* sessions.open({
          cwd: fixture.root,
          sessionId: "defaults-existing",
          model: "piano-phase0/global",
          thinkingLevel: "low",
        });
        const original = yield* session.state;
        const wanted = { model: "piano-phase0/global", thinkingLevel: "high" } as const;
        yield* settings.saveDefaults(wanted);
        const written = {
          defaultProvider: "piano-phase0",
          defaultModel: "global",
          defaultThinkingLevel: "high",
        };
        assert.deepEqual(saved(), written);
        const persisted = JSON.parse(readFileSync(path, "utf8"));
        assert.equal(persisted.theme, "dark");
        assert.equal(persisted.cacheWarming, "off");
        const next = yield* catalogs.catalog(fixture.root);
        assert.equal(next.defaultModel, wanted.model);
        assert.equal(next.defaultThinkingLevel, "high");
        assert.notEqual(next.fetchedAt, initial.fetchedAt);
        const overridden = yield* catalogs.catalog(project);
        assert.equal(overridden.defaultModel, "piano-phase0/project");
        assert.equal(overridden.defaultThinkingLevel, "high");
        assert.equal((yield* session.state).model, original.model);
        assert.equal((yield* session.state).thinkingLevel, "low");
        assert.equal(
          SettingsManager.create(project, fixture.agentDir, {
            projectTrusted: true,
          }).getDefaultModel(),
          "project",
        );
        assert.equal(
          (yield* Effect.result(
            settings.saveDefaults({ model: "missing/model", thinkingLevel: "low" }),
          ))._tag,
          "Failure",
        );
        assert.deepEqual(saved(), written);
        yield* settings.saveDefaults({ thinkingLevel: "medium" });
        assert.deepEqual(saved(), { ...written, defaultThinkingLevel: "medium" });
        chmodSync(path, 0o400);
        assert.equal(
          (yield* Effect.result(settings.saveDefaults({ thinkingLevel: "low" })))._tag,
          "Failure",
        );
        chmodSync(path, 0o600);
        assert.deepEqual(saved(), { ...written, defaultThinkingLevel: "medium" });
        writeFileSync(path, "{broken");
        assert.equal(
          (yield* Effect.result(settings.saveDefaults({ thinkingLevel: "low" })))._tag,
          "Failure",
        );
        assert.equal(readFileSync(path, "utf8"), "{broken");
      }).pipe(
        Effect.scoped,
        Effect.provide(layer),
        Effect.provideService(PiCli, fixture.cli()),
        Effect.timeout("40 seconds"),
      ),
    );
    assert.equal(fixture.observe().requests.length, 0, "defaults do not call a model");
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fixture.close();
  }
});
