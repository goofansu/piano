/**
 * Model catalog for the picker: pi's own list of usable models and its
 * default, from a one-shot probe. `enabledModels` marks the preferred subset.
 */
import { homedir } from "node:os";
import { Context, Effect, Layer, Ref } from "effect";
import type { ModelCatalog, ModelChoice } from "../shared/wire.ts";
import { enabledModelPatterns } from "./PiEnv.ts";
import { PiThreads } from "./PiThreads.ts";

export class Catalog extends Context.Service<
  Catalog,
  {
    /** Cached catalog, loading it on first use. */
    readonly get: Effect.Effect<ModelCatalog>;
    /** Re-run the probe. */
    readonly refresh: Effect.Effect<ModelCatalog>;
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

export const CatalogLive = Layer.effect(
  Catalog,
  Effect.gen(function* () {
    const threads = yield* PiThreads;
    const cache = yield* Ref.make<ModelCatalog | undefined>(undefined);

    const load: Effect.Effect<ModelCatalog> = Effect.gen(function* () {
      const cwd = homedir();
      const probe = yield* threads.probe(cwd);
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
        };
      });
      models.sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.ref.localeCompare(b.ref));
      const catalog: ModelCatalog = {
        models,
        defaultModel: probe.defaultModel,
        defaultThinkingLevel: probe.defaultThinkingLevel,
        fetchedAt: new Date().toISOString(),
      };
      return catalog;
    }).pipe(
      Effect.catchTag("PiThreadError", (e) => {
        const failed: ModelCatalog = { models: [], fetchedAt: new Date().toISOString(), error: e.detail };
        return Effect.succeed(failed);
      }),
      Effect.tap((c) => Ref.set(cache, c)),
      Effect.tap((c) =>
        c.error
          ? Effect.logWarning(`model catalog: ${c.error}`)
          : Effect.logInfo(`${c.models.length} models available, default ${c.defaultModel ?? "(none)"}`),
      ),
    );

    return Catalog.of({
      get: Ref.get(cache).pipe(Effect.flatMap((c) => (c ? Effect.succeed(c) : load))),
      refresh: load,
    });
  }),
);
