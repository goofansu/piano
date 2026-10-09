/**
 * Model catalog for the picker: Pi's own list of usable models and its
 * default, from a one-shot probe cached per cwd until refreshed. `enabledModels`
 * marks the preferred subset.
 */
import { homedir } from "node:os";
import { Context, Effect, Layer, PubSub, Semaphore, Stream } from "effect";
import type { ModelCatalog, ModelChoice, ThinkingLevel } from "../shared/wire.ts";
import { enabledModelPatterns } from "./PiEnv.ts";
import { PiSessions } from "./PiSessions.ts";

export class Catalog extends Context.Service<
  Catalog,
  {
    /** Cached catalog, loading it on first use. */
    readonly get: (cwd: string) => Effect.Effect<ModelCatalog>;
    /** Global resources only, for machine-wide settings. */
    readonly global: Effect.Effect<ModelCatalog>;
    readonly changes: Stream.Stream<void>;
    /** Credentials or defaults changed; every client's pickers must re-probe. */
    readonly invalidate: Effect.Effect<void>;
    /** Re-run the probe. */
    readonly refresh: (cwd: string) => Effect.Effect<ModelCatalog>;
  }
>()("piano/Catalog") {}

function patternMatcher(patterns: string[]): (ref: string, id: string) => boolean {
  const tests = patterns.map((p) => {
    const lowered = p.toLowerCase();
    if (lowered.includes("*")) {
      const re = new RegExp(`^${lowered.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
      return (ref: string, id: string) => re.test(ref) || re.test(id);
    }
    return (ref: string, id: string) => ref === lowered || id === lowered;
  });
  return (ref, id) => tests.some((t) => t(ref.toLowerCase(), id.toLowerCase()));
}

const LEVELS: ThinkingLevel[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/** The same rule Pi applies (pi-ai getSupportedThinkingLevels): a non-reasoning model only has off; a level mapped to null is out; xhigh and max need an explicit mapping. */
function supportedThinkingLevels(m: { reasoning: boolean; thinkingLevelMap?: Record<string, string | null | undefined> }): ThinkingLevel[] {
  if (!m.reasoning) return ["off"];
  return LEVELS.filter((level) => {
    const mapped = m.thinkingLevelMap?.[level];
    if (mapped === null) return false;
    if (level === "xhigh" || level === "max") return mapped !== undefined;
    return true;
  });
}

export const CatalogLive = Layer.effect(
  Catalog,
  Effect.gen(function* () {
    const sessions = yield* PiSessions;
    // null is the global catalog, separate even from a probe of the same cwd.
    const cache = new Map<string | null, ModelCatalog>();
    const locks = new Map<string | null, Semaphore.Semaphore>();
    const changes = yield* PubSub.sliding<void>(1);
    let epoch = 0;
    const locked = (key: string | null, refresh = false) => Effect.gen(function* () {
      let lock = locks.get(key);
      if (!lock) { lock = yield* Semaphore.make(1); locks.set(key, lock); }
      return yield* Semaphore.withPermits(lock, 1)(Effect.suspend(() =>
        !refresh && cache.has(key) ? Effect.succeed(cache.get(key)!) : load(key)));
    });

    const load = (key: string | null): Effect.Effect<ModelCatalog> => Effect.gen(function* () {
      const loadingEpoch = epoch;
      const cwd = key ?? homedir();
      const probe = yield* sessions.probe(cwd, { globalSettingsOnly: key === null });
      // An invalidation while Pi was starting must not return or cache old defaults.
      if (loadingEpoch !== epoch) return yield* load(key);
      const isEnabled = patternMatcher(key === null ? [] : enabledModelPatterns(cwd));
      const models: ModelChoice[] = probe.models.map((m) => {
        const ref = `${m.provider}/${m.id}`;
        return {
          ref,
          provider: m.provider,
          id: m.id,
          name: m.name,
          reasoning: !!m.reasoning,
          contextWindow: m.contextWindow,
          enabled: isEnabled(ref, m.id),
          thinkingLevels: supportedThinkingLevels(m),
        };
      });
      const catalog: ModelCatalog = {
        cwd, models, commands: probe.commands,
        defaultModel: probe.defaultModel,
        defaultThinkingLevel: probe.defaultThinkingLevel,
        fetchedAt: new Date().toISOString(),
      };
      cache.set(key, catalog);
      return catalog;
    }).pipe(
      Effect.catchTag("PiSessionError", (e) => {
        const failed: ModelCatalog = { cwd: key ?? homedir(), models: [], fetchedAt: new Date().toISOString(), error: e.detail };
        return Effect.succeed(failed);
      }),
      // A failed probe is not cached, so the next request retries it.
      Effect.tap((c) => Effect.sync(() => { if (c.error) cache.delete(key); })),
      Effect.tap((c) =>
        c.error
          ? Effect.logWarning(`model catalog: ${c.error}`)
          : Effect.logInfo(`${c.models.length} models available, default ${c.defaultModel ?? "(none)"}`),
      ),
    );

    return Catalog.of({
      invalidate: Effect.sync(() => { epoch++; cache.clear(); }).pipe(Effect.andThen(PubSub.publish(changes, undefined)), Effect.asVoid),
      changes: Stream.fromPubSub(changes),
      global: locked(null),
      get: cwd => locked(cwd),
      refresh: cwd => locked(cwd, true),
    });
  }),
);
