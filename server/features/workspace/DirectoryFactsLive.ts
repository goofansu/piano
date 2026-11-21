import { homedir } from "node:os";
import { Effect, Fiber, Layer, PubSub, Semaphore, Stream } from "effect";
import { type ModelCatalog, SLASH_COMMANDS_TIMEOUT_MS } from "../../../shared/wire.ts";
import {
  DirectoryCommandsError,
  DirectoryFacts,
  type DirectoryTrust,
} from "../../shared/DirectoryFacts.ts";
import { directoryPath } from "../../shared/PiEnv.ts";
import { PiSessions } from "../sessions/pi/PiSessions.ts";
import { projectTrust, setProjectTrust } from "./ProjectTrust.ts";

export const DirectoryFactsLive = Layer.effect(
  DirectoryFacts,
  Effect.gen(function* () {
    const sessions = yield* PiSessions;
    const scope = yield* Effect.scope;
    const cache = new Map<string | null, ModelCatalog>();
    const locks = new Map<string | null, Semaphore.Semaphore>();
    const changes = yield* PubSub.sliding<void>(1);
    let epoch = 0;
    const locked = Effect.fn("DirectoryFacts.locked")(function* (
      key: string | null,
      refresh = false,
    ) {
      let lock = locks.get(key);
      if (!lock) {
        lock = yield* Semaphore.make(1);
        locks.set(key, lock);
      }
      return yield* Semaphore.withPermits(
        lock,
        1,
      )(
        Effect.suspend(() =>
          !refresh && cache.has(key) ? Effect.succeed(cache.get(key)!) : load(key),
        ),
      );
    });

    const load: (key: string | null) => Effect.Effect<ModelCatalog> = Effect.fn(
      "DirectoryFacts.load",
    )(
      function* (key: string | null) {
        const loadingEpoch = epoch;
        const cwd = key ?? homedir();
        const probe = yield* sessions.probe(cwd, { globalSettingsOnly: key === null });
        if (loadingEpoch !== epoch) return yield* load(key);
        const catalog: ModelCatalog = {
          cwd,
          models: probe.models,
          commands: probe.commands,
          defaultModel: probe.defaultModel,
          defaultThinkingLevel: probe.defaultThinkingLevel,
          fetchedAt: new Date().toISOString(),
        };
        cache.set(key, catalog);
        return catalog;
      },
      (effect, key) =>
        effect.pipe(
          Effect.catchTag("PiSessionError", (e) => {
            const failed: ModelCatalog = {
              cwd: key ?? homedir(),
              models: [],
              fetchedAt: new Date().toISOString(),
              error: e.detail,
            };
            return Effect.succeed(failed);
          }),
          Effect.tap((c) =>
            Effect.sync(() => {
              if (c.error) cache.delete(key);
            }),
          ),
          Effect.tap((c) =>
            c.error
              ? Effect.logWarning(`model catalog: ${c.error}`)
              : Effect.logInfo(
                  `${c.models.length} models available, default ${c.defaultModel ?? "(none)"}`,
                ),
          ),
        ),
    );

    const invalidate = Effect.sync(() => {
      epoch++;
      cache.clear();
    }).pipe(Effect.andThen(PubSub.publish(changes, undefined)), Effect.asVoid);
    const trust = (raw: string) => {
      const cwd = directoryPath(raw);
      return Effect.map(projectTrust(cwd), (trust): DirectoryTrust => ({ cwd, trust }));
    };
    const catalog = (raw: string, options?: { readonly refresh?: boolean }) =>
      locked(directoryPath(raw), options?.refresh);

    return DirectoryFacts.of({
      trust,
      catalog,
      global: locked(null),
      commands: Effect.fn("DirectoryFacts.commands")(function* (raw) {
        const probe = yield* Effect.forkIn(locked(directoryPath(raw), true), scope);
        const probed = yield* Fiber.join(probe).pipe(
          Effect.timeoutOrElse({
            duration: SLASH_COMMANDS_TIMEOUT_MS,
            orElse: () =>
              Effect.fail(
                new DirectoryCommandsError({
                  detail: `Pi did not list its commands within ${SLASH_COMMANDS_TIMEOUT_MS / 1000} seconds. Try again.`,
                }),
              ),
          }),
        );
        if (probed.error) return yield* new DirectoryCommandsError({ detail: probed.error });
        return probed.commands ?? [];
      }),
      setTrust: Effect.fn("DirectoryFacts.setTrust")(function* (raw, trusted) {
        const cwd = directoryPath(raw);
        yield* setProjectTrust(cwd, trusted);
        yield* invalidate;
        const catalog = yield* locked(cwd);
        return { ...(yield* trust(cwd)), catalog };
      }),
      invalidate,
      changes: Effect.map(PubSub.subscribe(changes), Stream.fromSubscription),
    });
  }),
);
