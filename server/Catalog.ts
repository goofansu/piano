/**
 * Model catalog for the picker: Pi's own list of usable models and its
 * default, from a one-shot probe cached per cwd until refreshed. `enabledModels`
 * marks the preferred subset.
 */
import { Context, Effect, Layer, Semaphore } from "effect";
import type { ModelCatalog, ModelChoice, ThinkingLevel } from "../shared/wire.ts";
import { enabledModelPatterns } from "./PiEnv.ts";
import { PiSessions } from "./PiSessions.ts";

export class Catalog extends Context.Service<
  Catalog,
  {
    /** Cached catalog, loading it on first use. */
    readonly get: (cwd: string) => Effect.Effect<ModelCatalog>;
    /** Credentials changed; new session pickers must not reuse old availability. */
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
    const cache = new Map<string, ModelCatalog>();
    const locks = new Map<string, Semaphore.Semaphore>();
    let epoch = 0;
    const locked = (cwd: string, refresh = false) => Effect.gen(function* () {
      let lock = locks.get(cwd);
      if (!lock) { lock = yield* Semaphore.make(1); locks.set(cwd, lock); }
      return yield* Semaphore.withPermits(lock, 1)(Effect.suspend(() =>
        !refresh && cache.has(cwd) ? Effect.succeed(cache.get(cwd)!) : load(cwd)));
    });

    const load = (cwd: string): Effect.Effect<ModelCatalog> => Effect.gen(function* () {
      const loadingEpoch = epoch;
      const probe = yield* sessions.probe(cwd);
      const isEnabled = patternMatcher(enabledModelPatterns(cwd));
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
      if (loadingEpoch === epoch) cache.set(cwd, catalog);
      return catalog;
    }).pipe(
      Effect.catchTag("PiSessionError", (e) => {
        const failed: ModelCatalog = { cwd, models: [], fetchedAt: new Date().toISOString(), error: e.detail };
        return Effect.succeed(failed);
      }),
      // A failed probe is not cached, so the next request retries it.
      Effect.tap((c) => Effect.sync(() => { if (c.error) cache.delete(cwd); })),
      Effect.tap((c) =>
        c.error
          ? Effect.logWarning(`model catalog: ${c.error}`)
          : Effect.logInfo(`${c.models.length} models available, default ${c.defaultModel ?? "(none)"}`),
      ),
    );

    return Catalog.of({
      invalidate: Effect.sync(() => { epoch++; cache.clear(); }),
      get: cwd => locked(cwd),
      refresh: cwd => locked(cwd, true),
    });
  }),
);
