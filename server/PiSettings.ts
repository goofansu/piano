/** Machine-wide startup preferences. Pi owns the file, locking, merging and errors. */
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { Context, Data, Effect, Layer, Semaphore } from "effect";
import type { SessionDefaults } from "../shared/wire.ts";
import { DirectoryFacts } from "./DirectoryFacts.ts";
import { agentDir } from "./PiEnv.ts";

export class PiSettingsError extends Data.TaggedError("PiSettingsError")<{ readonly detail: string }> {}

export class PiSettings extends Context.Service<PiSettings, {
  readonly defaults: Effect.Effect<SessionDefaults, PiSettingsError>;
  readonly saveDefaults: (defaults: SessionDefaults) => Effect.Effect<SessionDefaults, PiSettingsError>;
}>()("piano/PiSettings") {}

function manager() {
  const settings = SettingsManager.create(process.cwd(), agentDir(), { projectTrusted: false });
  if (settings.drainErrors().length) throw new Error("Could not read Pi settings.");
  return settings;
}

function defaultsOf(settings: SettingsManager): SessionDefaults {
  const { defaultProvider, defaultModel, defaultThinkingLevel } = settings.getGlobalSettings();
  return {
    model: defaultProvider && defaultModel ? `${defaultProvider}/${defaultModel}` : undefined,
    thinkingLevel: defaultThinkingLevel ?? "medium",
  };
}

export const PiSettingsLive = Layer.effect(PiSettings, Effect.gen(function* () {
  const facts = yield* DirectoryFacts;
  const lock = yield* Semaphore.make(1);
  const read = Effect.try({ try: () => defaultsOf(manager()), catch: () => new PiSettingsError({ detail: "Could not read Pi settings. Check the settings file and try again." }) });
  return PiSettings.of({
    defaults: Semaphore.withPermits(lock, 1)(read),
    saveDefaults: next => Semaphore.withPermits(lock, 1)(Effect.gen(function* () {
      const current = yield* read;
      if (next.model !== undefined && next.model !== current.model) {
        const available = yield* facts.global;
        if (available.error) return yield* new PiSettingsError({ detail: "Could not load models. Refresh and try again." });
        if (!available.models.some(model => model.ref === next.model)) return yield* new PiSettingsError({ detail: "Choose an available model." });
      }
      return yield* Effect.tryPromise({
        try: async () => {
          const settings = manager();
          // No model in the request means keep Pi's automatic/existing selection.
          if (next.model !== undefined) {
            const slash = next.model.indexOf("/");
            settings.setDefaultModelAndProvider(next.model.slice(0, slash), next.model.slice(slash + 1));
          }
          settings.setDefaultThinkingLevel(next.thinkingLevel);
          await settings.flush();
          // Pi records I/O failures instead of rejecting flush(). Never claim a failed save succeeded.
          if (settings.drainErrors().length) throw new Error("Could not write Pi settings.");
          return defaultsOf(manager());
        },
        catch: () => new PiSettingsError({ detail: "Could not save Pi settings. Check file permissions and reload before retrying." }),
      }).pipe(Effect.ensuring(facts.invalidate));
    })),
  });
}));
